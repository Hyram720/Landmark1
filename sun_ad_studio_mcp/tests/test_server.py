import base64
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from http.server import ThreadingHTTPServer

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import PROFESSIONAL_CAMERA_MOTIONS, TOOLS, Studio, dispatch, handler_for, higgsfield_credentials


class StudioTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.calls = []
        self.mock_responses = []
        self.env = {'HF_KEY': 'test_id_123:test_secret_456'}
        self.studio = Studio(
            Path(self.temp.name) / 'db.sqlite3',
            transport=self.fake_transport,
            dns_resolver=lambda host: ['93.184.216.34'],
            env=self.env,
        )
        self.brand = self.studio.call('save_brand', dict(
            name='Example Roofing',
            facts='Roof inspections in South Jersey',
            audience='Homeowners',
        ))

    def fake_transport(self, method, url, headers=None, json_body=None, timeout=20):
        self.calls.append({'method': method, 'url': url, 'headers': headers or {}, 'json': json_body})
        if self.mock_responses:
            nxt = self.mock_responses.pop(0)
            if isinstance(nxt, Exception):
                raise nxt
            return nxt
        return {'status': 200, 'headers': {}, 'body': b'{}', 'content_type': 'application/json'}

    def project(self, fmt='image'):
        return self.studio.call('create_project', dict(
            brand_id=self.brand['id'],
            offer='Book an inspection',
            format=fmt,
            destination='https://example.com/contact',
            request_key=fmt,
        ))

    def copy(self, p, headline='Check your roof', **extra):
        payload = dict(
            project_id=p['id'],
            headline=headline,
            body='Explore inspection options for your home.',
            cta='Learn more',
        )
        payload.update(extra)
        return self.studio.call('save_copy', payload)

    def test_shared_storage_and_copy_revisions(self):
        p = self.project()
        self.copy(p)
        self.copy(p, 'Plan your next inspection')
        other = Studio(self.studio.path)
        bundle = other.call('get_project', {'project_id': p['id']})
        self.assertEqual(len(bundle['revisions']), 2)
        self.assertEqual(bundle['brand']['facts'], self.brand['facts'])

    def test_concurrent_idempotent_create_and_key_conflict(self):
        with ThreadPoolExecutor(max_workers=4) as pool:
            result = list(pool.map(lambda _: self.project(), range(8)))
        self.assertEqual(len({p['id'] for p in result}), 1)
        with self.assertRaisesRegex(ValueError, 'different arguments'):
            self.studio.call('create_project', dict(
                brand_id=self.brand['id'],
                offer='Different',
                format='image',
                destination='https://example.com',
                request_key='image',
            ))

    def test_video_gate_snapshot_and_no_submission(self):
        p = self.project('video')
        self.copy(p)
        args = dict(project_id=p['id'], provider='unconfigured', model='unconfigured', request_key='v1')
        with self.assertRaisesRegex(ValueError, 'Approve'):
            self.studio.call('prepare_render_handoff', args)
        with self.assertRaises(ValueError):
            self.studio.call('approve_start_image', dict(
                project_id=p['id'], image_url='https://example.com/a.png', user_approved=False))
        self.studio.call('approve_start_image', dict(
            project_id=p['id'], image_url='https://example.com/a.png', user_approved=True))
        handoff = self.studio.call('prepare_render_handoff', args)
        self.copy(p, 'A newer headline')
        self.assertEqual(handoff['copy_snapshot']['headline'], 'Check your roof')
        self.assertEqual(handoff['status'], 'prepared_not_submitted')
        self.assertIsNone(handoff['cost'])
        self.assertEqual(self.studio.call('prepare_render_handoff', args)['id'], handoff['id'])

    def test_validation_and_svg_escaping(self):
        p = self.project()
        self.copy(p, '<script>')
        result = self.studio.call('render_static_svg', {'project_id': p['id']})
        svg = base64.b64decode(result['base64']).decode()
        self.assertNotIn('<script>', svg)
        self.assertIn('&lt;script&gt;', svg)
        for args in [dict(name='X', facts='Y', audience='Z', color='red'),
                     dict(name='X', facts='Y', audience='Z', extra='bad')]:
            with self.assertRaises(ValueError):
                self.studio.call('save_brand', args)

    def test_rpc_errors_and_notification(self):
        self.assertEqual(dispatch(self.studio, [])['error']['code'], -32600)
        self.assertIsNone(dispatch(self.studio, dict(jsonrpc='2.0', method='notifications/initialized')))
        result = dispatch(self.studio, dict(jsonrpc='2.0', id=2, method='tools/call', params={'name': 'missing'}))
        self.assertTrue(result['result']['isError'])

    def test_stdio_lifecycle(self):
        messages = [
            dict(jsonrpc='2.0', id=1, method='initialize', params={'protocolVersion': '2025-11-25'}),
            dict(jsonrpc='2.0', method='notifications/initialized'),
            dict(jsonrpc='2.0', id=2, method='tools/list'),
        ]
        proc = subprocess.run(
            [sys.executable, str(Path(__file__).resolve().parents[1] / 'server.py'),
             '--db', str(Path(self.temp.name) / 'stdio.sqlite3')],
            input='\n'.join(map(json.dumps, messages)) + '\n',
            text=True,
            capture_output=True,
            check=True,
        )
        results = [json.loads(s) for s in proc.stdout.splitlines()]
        self.assertEqual(len(results), 2)
        self.assertEqual(results[0]['result']['protocolVersion'], '2025-11-25')
        self.assertEqual(len(results[1]['result']['tools']), len(TOOLS))

    def test_http_lifecycle_auth_origin_host_and_versions(self):
        token = 't' * 40
        server = ThreadingHTTPServer(('127.0.0.1', 0), handler_for(self.studio, token, {'studio.test'}, set()))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        url = 'http://127.0.0.1:%d/mcp' % server.server_port

        def request(message=None, **overrides):
            headers = {
                'Host': 'studio.test',
                'Authorization': 'Bearer ' + token,
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/event-stream',
            }
            headers.update(overrides)
            return urlopen(Request(url, data=json.dumps(message).encode() if message is not None else None, headers=headers))

        with request(dict(jsonrpc='2.0', id=1, method='initialize', params={'protocolVersion': '2025-06-18'})) as r:
            self.assertEqual(json.load(r)['result']['protocolVersion'], '2025-06-18')
        with request(dict(jsonrpc='2.0', method='notifications/initialized')) as r:
            self.assertEqual(r.status, 202)
            self.assertEqual(r.read(), b'')
        for overrides, code in [
            ({'Authorization': 'bad'}, 401),
            ({'Origin': 'https://evil.example'}, 403),
            ({'Host': 'evil.example'}, 403),
            ({'MCP-Protocol-Version': 'bad'}, 400),
        ]:
            with self.assertRaises(HTTPError) as exc:
                request(dict(jsonrpc='2.0', id=2, method='ping'), **overrides)
            self.assertEqual(exc.exception.code, code)
        with self.assertRaises(HTTPError) as exc:
            request()
        self.assertEqual(exc.exception.code, 405)

    def test_higgsfield_pricing_submit_poll_archive_and_429(self):
        self.assertEqual(higgsfield_credentials({'HF_KEY': 'id1:sec2'}), ('id1', 'sec2'))
        self.assertEqual(
            higgsfield_credentials({'HF_API_KEY_ID': 'id3', 'HF_KEY_SECRET': 'sec4'}),
            ('id3', 'sec4'),
        )
        p = self.project('image')
        self.copy(p, 'Arcade Pet Fighter Tee', remix_style='16bit_arcade', variant_tag='var_a')
        handoff = self.studio.call('prepare_render_handoff', dict(
            project_id=p['id'],
            provider='higgsfield',
            model='workflows/product-shots',
            resolution='2k',
            request_key='hf-shot-1',
        ))
        self.assertEqual(handoff['cost'], 0.0189)
        self.assertEqual(handoff['variant_tag'], 'var_a')
        with self.assertRaisesRegex(ValueError, 'user_spend_approved=True'):
            self.studio.call('submit_render_job', dict(
                handoff_id=handoff['id'], user_spend_approved=False, request_key='sub-deny'))

        self.mock_responses.append({
            'status': 429,
            'headers': {'Retry-After': '12'},
            'body': json.dumps({'retry_after_seconds': 12}).encode(),
        })
        rl_job = self.studio.call('submit_render_job', dict(
            handoff_id=handoff['id'], user_spend_approved=True, request_key='sub-429'))
        self.assertEqual(rl_job['status'], 'rate_limited')
        self.assertEqual(rl_job['retry_after_seconds'], 12)
        self.assertEqual(rl_job['reserved_usd'], 0.0)

        self.mock_responses.append({
            'status': 202,
            'headers': {},
            'body': json.dumps({
                'request_id': 'req_abc123',
                'status': 'queued',
                'status_url': 'https://api.higgsfield.ai/requests/req_abc123/status',
            }).encode(),
        })
        job = self.studio.call('submit_render_job', dict(
            handoff_id=handoff['id'], user_spend_approved=True, request_key='sub-ok'))
        self.assertEqual(job['status'], 'queued')
        self.assertEqual(job['request_id'], 'req_abc123')
        self.assertEqual(self.calls[-1]['headers']['Idempotency-Key'], handoff['id'])
        self.assertEqual(self.calls[-1]['headers']['Authorization'], 'Key test_id_123:test_secret_456')

        self.mock_responses.append({
            'status': 200,
            'headers': {},
            'body': json.dumps({
                'status': 'completed',
                'images': [{'url': 'https://cdn.higgsfield.ai/out/arcade.png'}],
            }).encode(),
        })
        self.mock_responses.append({
            'status': 200,
            'headers': {},
            'body': b'\x89PNG\r\n\x1a\nfakepngbytes',
        })
        done_job = self.studio.call('check_render_job', {'job_id': job['id']})
        self.assertEqual(done_job['status'], 'completed')
        self.assertEqual(done_job['settled_usd'], 0.0189)
        self.assertEqual(len(done_job['archived_files']), 1)
        self.assertTrue(Path(done_job['archived_files'][0]).exists())

    def test_viral_hook_library_batch_caps_and_winner_feedback_loop(self):
        hook = self.studio.call('save_hook_seed', dict(
            title='JohnnyTube Brass Fox Walk-and-Talk Hook',
            source_url='https://www.youtube.com/watch?v=_xx2p6Xc9jQ',
            hook_opening='Stop buying boring gifts that end up in the back of the closet.',
            beat_sheet='Beat 1: Direct camera challenge. Beat 2: Product reveal. Beat 3: Social proof + CTA.',
            remix_style='16bit_arcade_boss',
            niche='custom pet gifts',
        ))
        p = self.project('video')
        brief = self.studio.call('vibe_direct_brief', dict(project_id=p['id'], hook_id=hook['id']))
        self.assertEqual(brief['hook_seed']['id'], hook['id'])
        self.copy(p, 'Insert Treat To Continue', hook_id=hook['id'], remix_style='16bit_arcade_boss', variant_tag='v1')
        self.studio.call('approve_start_image', dict(
            project_id=p['id'], image_url='https://example.com/start.png', user_approved=True))

        with self.assertRaisesRegex(ValueError, 'exceeds max_spend_usd cap'):
            self.studio.call('queue_batch_handoffs', dict(
                project_id=p['id'],
                provider='higgsfield',
                model='pixverse/v6/image-to-video',
                resolution='720p',
                duration_seconds=5,
                variant_tags='hook_a,hook_b,hook_c',
                hook_id=hook['id'],
                remix_style='16bit_arcade_boss',
                max_spend_usd=0.50,
                request_key='batch-too-high',
            ))
        batch = self.studio.call('queue_batch_handoffs', dict(
            project_id=p['id'],
            provider='higgsfield',
            model='pixverse/v6/image-to-video',
            resolution='720p',
            duration_seconds=5,
            variant_tags='hook_a,hook_b,hook_c',
            hook_id=hook['id'],
            remix_style='16bit_arcade_boss',
            max_spend_usd=1.00,
            request_key='batch-ok',
        ))
        self.assertEqual(batch['count'], 3)
        self.assertAlmostEqual(batch['total_quoted_usd'], 0.765, places=4)
        self.assertAlmostEqual(batch['cumulative_quoted_usd'], 0.765, places=4)

        # Second batch of $0.51 alone is under $1.00, but cumulative ($0.765 + $0.51 = $1.275) exceeds $1.00 cap
        with self.assertRaisesRegex(ValueError, 'exceeds max_spend_usd cap'):
            self.studio.call('queue_batch_handoffs', dict(
                project_id=p['id'],
                provider='higgsfield',
                model='pixverse/v6/image-to-video',
                resolution='720p',
                duration_seconds=5,
                variant_tags='hook_d,hook_e',
                hook_id=hook['id'],
                remix_style='16bit_arcade_boss',
                max_spend_usd=1.00,
                request_key='batch-cumulative-exceeded',
            ))

        # Gap 1: A later call cannot raise the project cap without user_cap_increase_approved=True
        with self.assertRaisesRegex(ValueError, 'requires explicit user_cap_increase_approved=True'):
            self.studio.call('queue_batch_handoffs', dict(
                project_id=p['id'],
                provider='higgsfield',
                model='pixverse/v6/image-to-video',
                resolution='720p',
                duration_seconds=5,
                variant_tags='hook_d,hook_e',
                hook_id=hook['id'],
                remix_style='16bit_arcade_boss',
                max_spend_usd=50.00,
                request_key='batch-unauthorized-cap-raise',
            ))

        # Gap 2: When a submitted handoff render job is canceled/failed, its reserved budget is released
        self.studio.env['HF_KEY'] = 'kid:ksec'
        def fake_cancel_transport(method, url, headers=None, json_body=None, timeout=20):
            if method == 'POST':
                return {'status': 200, 'headers': {}, 'body': b'{"request_id":"req-c1","status":"queued","status_url":"https://api.higgsfield.ai/requests/req-c1/status"}'}
            return {'status': 200, 'headers': {}, 'body': b'{"status":"canceled"}'}
        self.studio.transport = fake_cancel_transport
        sub_job = self.studio.call('submit_render_job', dict(
            handoff_id=batch['handoffs'][0]['id'],
            user_spend_approved=True,
            request_key='sub-c1',
        ))
        polled = self.studio.call('check_render_job', dict(job_id=sub_job['id']))
        self.assertEqual(polled['status'], 'canceled')
        self.assertTrue(polled['refunded'])

        # Now prior active spend is $0.51 (2 active handoffs), so 1 replacement ($0.255) fits under $1.00 cap ($0.765 total)
        replacement = self.studio.call('queue_batch_handoffs', dict(
            project_id=p['id'],
            provider='higgsfield',
            model='pixverse/v6/image-to-video',
            resolution='720p',
            duration_seconds=5,
            variant_tags='hook_replacement',
            hook_id=hook['id'],
            remix_style='16bit_arcade_boss',
            max_spend_usd=1.00,
            request_key='batch-after-cancel-refund',
        ))
        self.assertAlmostEqual(replacement['prior_quoted_usd'], 0.51, places=4)
        self.assertAlmostEqual(replacement['cumulative_quoted_usd'], 0.765, places=4)

        # Queue 1 more replacement ($0.255) to bring active spend to $1.02? No, under $1.00 cap, let us raise cap to $0.90? Wait:
        # Currently active spend is $0.765 (3 active handoffs x $0.255) and project cap is $1.00.
        # Resubmitting the canceled handoff ($0.255) would bring active spend to $0.765 + $0.255 = $1.02 > $1.00 cap, so submit_render_job rejects it!
        with self.assertRaisesRegex(ValueError, 'exceeding project max_spend_usd cap'):
            self.studio.call('submit_render_job', dict(
                handoff_id=batch['handoffs'][0]['id'],
                user_spend_approved=True,
                request_key='sub-c1-resubmit-over-cap',
            ))

        # And raising the cap with explicit user_cap_increase_approved=True succeeds and persists the new cap
        raised = self.studio.call('queue_batch_handoffs', dict(
            project_id=p['id'],
            provider='higgsfield',
            model='pixverse/v6/image-to-video',
            resolution='720p',
            duration_seconds=5,
            variant_tags='hook_d,hook_e',
            hook_id=hook['id'],
            remix_style='16bit_arcade_boss',
            max_spend_usd=1.50,
            user_cap_increase_approved=True,
            request_key='batch-approved-cap-raise',
        ))
        self.assertAlmostEqual(raised['cumulative_quoted_usd'], 1.275, places=4)
        self.assertAlmostEqual(raised['max_spend_usd'], 1.50, places=4)

        fb = self.studio.call('record_winner_feedback', dict(
            project_id=p['id'],
            hook_id=hook['id'],
            variant_tag='hook_b',
            channel='etsy',
            orders_count=4,
            revenue_usd=159.96,
            notes='Washed Sage 16-bit arcade mockup had highest Etsy CTR',
        ))
        self.assertEqual(fb['promoted_hook']['total_orders'], 4)
        self.assertAlmostEqual(fb['promoted_hook']['conversion_score'], 199.96, places=2)
        pulled = self.studio.call('pull_hook_seeds', {'niche': 'pet'})['hooks']
        self.assertEqual(pulled[0]['id'], hook['id'])

    def test_ssrf_protection_on_extract_website_facts(self):
        for bad_url in [
            'http://example.com',
            'https://localhost/admin',
            'https://127.0.0.1/secret',
            'https://169.254.169.254/latest/meta-data/',
        ]:
            with self.assertRaises(ValueError):
                self.studio.call('extract_website_facts', {'url': bad_url})
        private_studio = Studio(
            Path(self.temp.name) / 'priv.sqlite3',
            transport=self.fake_transport,
            dns_resolver=lambda host: ['10.0.0.8'],
        )
        with self.assertRaisesRegex(ValueError, 'SSRF protection'):
            private_studio.call('extract_website_facts', {'url': 'https://internal.example.com'})



    def test_v030_subject_lock_storyboard_captions_safe_zones_and_engine_router(self):
        p = self.project('video')
        sub = self.studio.call('register_subject_ingredient', dict(
            project_id=p['id'],
            name='Barnaby the Arcade Corgi',
            kind='character',
            visual_dna='Expressive 3D Pixar-style Pembroke Welsh Corgi wearing a neon 1989 arcade visor',
            voice_persona='Warm, enthusiastic underdog hero',
            reference_image_url='https://example.com/barnaby.png',
            hex_palette='#071120,#94A596,#FFD700',
        ))
        listed = self.studio.call('list_subject_ingredients', {'project_id': p['id']})['subjects']
        self.assertEqual(len(listed), 1)
        self.assertEqual(listed[0]['id'], sub['id'])

        sb = self.studio.call('build_storyboard_timeline', dict(
            project_id=p['id'],
            title='Barnaby Arcade Launch Ad',
            aspect_ratio='9:16',
            transition_duration_seconds=0.5,
            scenes=[
                {
                    'duration_seconds': 6,
                    'visual_prompt': 'Barnaby stares at a boring plain white t-shirt',
                    'camera_motion': 'crash_zoom',
                    'transition_out': 'fade',
                    'dialogue_or_vo': 'Why are most custom pet shirts so bland?',
                    'subject_ids': [sub['id']],
                },
                {
                    'duration_seconds': 8,
                    'visual_prompt': 'Barnaby powers up into a 16-bit arcade fighter on a Washed Sage tee',
                    'camera_motion': 'orbit_360',
                    'transition_out': 'wipeleft',
                    'dialogue_or_vo': 'Insert Treat to Continue turns your pet into an arcade legend.',
                    'subject_ids': [sub['id']],
                },
            ],
        ))
        self.assertEqual(sb['scene_count'], 2)
        self.assertAlmostEqual(sb['total_timeline_seconds'], 13.5, places=2)
        self.assertIn('Pembroke Welsh Corgi', sb['scenes'][0]['injected_subject_dna'][0])

        cap = self.studio.call('generate_captions_and_vo_timing', dict(
            project_id=p['id'],
            script_text='Why are most custom pet shirts so bland? Insert Treat to Continue turns your pet into an arcade legend today!',
            total_duration_seconds=10.0,
            words_per_caption=4,
            style_preset='capcut_kinetic_pop',
        ))
        self.assertEqual(cap['word_count'], 20)
        self.assertEqual(cap['caption_count'], 5)
        self.assertTrue(Path(cap['srt_path']).exists())
        self.assertTrue(Path(cap['vtt_path']).exists())
        self.assertIn('WEBVTT', Path(cap['vtt_path']).read_text())

        zones = self.studio.call('plan_multiratio_safe_zones', dict(
            project_id=p['id'],
            ratios=['9:16', '4:5', '1:1', '16:9'],
        ))['safe_zones']
        self.assertEqual(zones['9:16']['width'], 1080)
        self.assertEqual(zones['16:9']['width'], 1920)

        bench = self.studio.call('compare_video_engines', dict(
            task_type='product_ads',
            duration_seconds=15.0,
            max_budget_usd=2.00,
        ))
        self.assertEqual(len(bench['rankings']), 12)
        self.assertEqual(bench['recommended_primary']['engine_id'], 'higgsfield')
        self.assertIn('STRICT_ZERO_PAID_API_REVERSE_ENGINEERING', bench['zero_spend_policy'])
        self.assertTrue(bench['all_12_require_payment_for_cloud_api'])
        self.assertIn('sora', bench['platforms_requiring_payment_to_test'])
        self.assertIn('veo', bench['platforms_requiring_payment_to_test'])
        self.assertIn('higgsfield', bench['platforms_requiring_payment_to_test'])
        for row in bench['rankings']:
            self.assertTrue(row['observable_without_spending'])
            self.assertTrue(row['cannot_evaluate_under_zero_spend_rule'])
            self.assertTrue(row['reverse_engineered_in_sun_ad_studio'])

    def test_v030_pixar_problem_solution_script_creator(self):
        hook = self.studio.call('save_hook_seed', dict(
            title='Pixar Problem Hook',
            hook_opening='Ever notice how generic pet gifts get forgotten in a drawer?',
            beat_sheet='Problem -> Escalation -> Hero Solution -> Joyful CTA',
            remix_style='pixar_3d_problem_solution',
            niche='custom pet gifts',
        ))
        p = self.project('video')
        pixar = self.studio.call('create_pixar_problem_solution_script', dict(
            project_id=p['id'],
            product_name='SunCustomDesigns 16-Bit Arcade Pet Tee & Throw Blanket',
            problem_statement='Every generic pet gift looks washed-out, boring, and nothing like your real dog',
            solution_statement='Turns your pet photo into a laser-sharp 1989 arcade fighter on Soft Washed Sage Comfort Colors tees and 50x60 blankets',
            character_name='Milo the Golden Retriever',
            character_archetype='Expressive golden retriever with floppy ears, big amber eyes, and a red bandana',
            clip_durations=[10, 10, 10],
            call_to_action='Upload your pet photo at custompetportraitstudio.com',
            hook_id=hook['id'],
            auto_save_copy=True,
        ))
        self.assertEqual(len(pixar['clips']), 3)
        self.assertAlmostEqual(pixar['total_duration_seconds'], 30.0, places=2)
        self.assertTrue(pixar['saved_copy_id'])
        self.assertIn('Milo the Golden Retriever', pixar['full_voiceover_script'])
        self.assertEqual(pixar['clips'][0]['duration_seconds'], 10.0)
        self.assertEqual(pixar['clips'][1]['duration_seconds'], 10.0)
        self.assertEqual(pixar['clips'][2]['duration_seconds'], 10.0)

    def test_v030_assemble_video_clips_all_video_all_image_and_mixed(self):
        p = self.project('video')
        # 1. All-video sequence: 10s + 10s + 10s (and variable lengths)
        all_video_plan = self.studio.call('assemble_video_clips', dict(
            project_id=p['id'],
            clips=[
                {'media_type': 'video', 'duration_seconds': 10.0, 'label': 'Clip 1 (Problem)'},
                {'media_type': 'video', 'duration_seconds': 10.0, 'label': 'Clip 2 (Solution)'},
                {'media_type': 'video', 'duration_seconds': 10.0, 'label': 'Clip 3 (CTA)'},
            ],
            transition_type='fade',
            transition_duration_seconds=0.5,
            aspect_ratio='9:16',
            execute_render=False,
        ))
        self.assertEqual(all_video_plan['sequence_mode'], 'all_video')
        self.assertEqual(all_video_plan['video_clip_count'], 3)
        self.assertEqual(all_video_plan['still_image_count'], 0)
        # 10 + 10 + 10 - (2 * 0.5 overlap) = 29.0s
        self.assertAlmostEqual(all_video_plan['total_output_duration_seconds'], 29.0, places=2)
        self.assertEqual(all_video_plan['xfade_transitions'][0]['offset_seconds'], 9.5)
        self.assertEqual(all_video_plan['xfade_transitions'][1]['offset_seconds'], 19.0)

        # 1b. All-video sequence rendered to real MP4 via FFmpeg (variable lengths: 1.5s + 2.0s + 1.5s)
        all_video_render = self.studio.call('assemble_video_clips', dict(
            project_id=p['id'],
            clips=[
                {'media_type': 'video', 'duration_seconds': 1.5, 'color_hex': '#071120', 'label': 'Video 1'},
                {'media_type': 'video', 'duration_seconds': 2.0, 'color_hex': '#1E3A8A', 'label': 'Video 2'},
                {'media_type': 'video', 'duration_seconds': 1.5, 'color_hex': '#065F46', 'label': 'Video 3'},
            ],
            transition_type='fade',
            transition_duration_seconds=0.5,
            aspect_ratio='9:16',
            execute_render=True,
        ))
        self.assertEqual(all_video_render['sequence_mode'], 'all_video')
        self.assertAlmostEqual(all_video_render['total_output_duration_seconds'], 4.0, places=2)
        self.assertTrue(all_video_render['rendered'])
        self.assertTrue(Path(all_video_render['output_mp4_path']).exists())

        # 2. All-image sequence rendered to real MP4 via FFmpeg
        all_image_render = self.studio.call('assemble_video_clips', dict(
            project_id=p['id'],
            clips=[
                {'media_type': 'image', 'duration_seconds': 1.5, 'color_hex': '#071120', 'label': 'Mockup Still 1'},
                {'media_type': 'image', ' color_hex': '#94A596', 'label': 'Mockup Still 2 (uses default duration)'} if False else {'media_type': 'image', 'color_hex': '#94A596', 'label': 'Mockup Still 2 (default dur)'},
                {'media_type': 'image', 'duration_seconds': 1.5, 'color_hex': '#FFD700', 'label': 'Mockup Still 3'},
            ],
            default_image_duration_seconds=2.0,
            transition_type='wipeleft',
            transition_duration_seconds=0.5,
            aspect_ratio='1:1',
            execute_render=True,
        ))
        self.assertEqual(all_image_render['sequence_mode'], 'all_image')
        self.assertEqual(all_image_render['still_image_count'], 3)
        self.assertEqual(all_image_render['video_clip_count'], 0)
        # 1.5 + 2.0 + 1.5 - (2 * 0.5) = 4.0s
        self.assertAlmostEqual(all_image_render['total_output_duration_seconds'], 4.0, places=2)
        self.assertTrue(all_image_render['rendered'])
        self.assertTrue(Path(all_image_render['output_mp4_path']).exists())
        self.assertGreater(all_image_render['output_bytes'], 1000)

        # 3. Mixed image + video sequence in arbitrary order rendered to real MP4 via FFmpeg
        mixed_render = self.studio.call('assemble_video_clips', dict(
            project_id=p['id'],
            clips=[
                {'media_type': 'image', 'duration_seconds': 1.5, 'color_hex': '#071120', 'label': 'Intro Hero Still'},
                {'media_type': 'video', 'duration_seconds': 2.0, 'color_hex': '#1E3A8A', 'label': 'Action Video Clip 1'},
                {'media_type': 'image', 'duration_seconds': 1.5, 'color_hex': '#065F46', 'label': 'Feature Callout Still'},
                {'media_type': 'video', 'duration_seconds': 2.5, 'color_hex': '#7C2D12', 'label': 'Closing Video Clip 2'},
            ],
            transition_type='dissolve',
            transition_duration_seconds=0.5,
            aspect_ratio='16:9',
            execute_render=True,
        ))
        self.assertEqual(mixed_render['sequence_mode'], 'mixed_image_and_video')
        self.assertEqual(mixed_render['still_image_count'], 2)
        self.assertEqual(mixed_render['video_clip_count'], 2)
        # 1.5 + 2.0 + 1.5 + 2.5 - (3 * 0.5) = 6.0s
        self.assertAlmostEqual(mixed_render['total_output_duration_seconds'], 6.0, places=2)
        self.assertTrue(mixed_render['rendered'])
        self.assertTrue(Path(mixed_render['output_mp4_path']).exists())

    def test_v030_short_films_module_create_list_and_assemble(self):
        p = self.project('video')
        film = self.studio.call('create_short_film', dict(
            project_id=p['id'],
            title='The Pixel Paws Chronicles',
            logline='A forgotten shelter pup steps into a glowing 1989 arcade cabinet and rallies a team of heroes to find their forever home.',
            genre='pixar_3d_heartwarmer',
            target_duration_seconds=120.0,
            characters=[
                {
                    'name': 'Khabba the Boxer',
                    'role': 'protagonist',
                    'visual_dna': 'Warm fawn Boxer dog with expressive amber eyes, white chest blaze, and glowing arcade headband',
                    'voice_persona': 'Brave, warm-hearted Pixar hero voice',
                },
                {
                    'name': 'Cleo the Strategist',
                    'role': 'co-star',
                    'visual_dna': 'Sleek companion with bright emerald collar and pixel-star aura',
                    'voice_persona': 'Quick-witted, loyal partner voice',
                },
            ],
            product_or_theme_integration='SunCustomDesigns Custom 16-Bit Arcade Pet Portrait Tee & Throw Blanket',
            aspect_ratio='16:9',
        ))
        self.assertEqual(film['title'], 'The Pixel Paws Chronicles')
        self.assertAlmostEqual(film['total_planned_duration_seconds'], 120.0, places=1)
        self.assertEqual(film['duration_minutes'], 2.0)
        self.assertEqual(len(film['characters']), 2)
        self.assertEqual(film['shot_count'], 8)

        films_list = self.studio.call('list_short_films', {'project_id': p['id']})['short_films']
        self.assertEqual(len(films_list), 1)

        # Also test assembling a compact custom-act short film with real FFmpeg render
        compact_film = self.studio.call('create_short_film', dict(
            project_id=p['id'],
            title='Micro Short Film Render Test',
            logline='A fast three-shot narrative test.',
            genre='cinematic_brand_film',
            target_duration_seconds=60.0,
            characters=[{'name': 'Scout', 'visual_dna': 'Expressive Pixar terrier with copper fur'}],
            acts=[
                {'act': 'Act I', 'shot_type': 'Wide', 'media_type': 'video', 'duration_seconds': 2.0, 'dialogue_or_narration': 'Act one begins here.'},
                {'act': 'Act II', 'shot_type': 'Portrait Still', 'media_type': 'image', 'duration_seconds': 1.5, 'dialogue_or_narration': 'A quiet turning point.'},
                {'act': 'Act III', 'shot_type': 'Hero Finale', 'media_type': 'video', 'duration_seconds': 2.0, 'dialogue_or_narration': 'The triumphant conclusion.'},
            ],
            aspect_ratio='16:9',
        ))
        assembled = self.studio.call('assemble_short_film', dict(
            project_id=p['id'],
            film_id=compact_film['id'],
            transition_type='fade',
            transition_duration_seconds=0.5,
            execute_render=True,
        ))
        self.assertTrue(assembled['short_film']['assembled'])
        self.assertTrue(assembled['assembly']['rendered'])
        self.assertEqual(assembled['assembly']['sequence_mode'], 'mixed_image_and_video')
        self.assertTrue(Path(assembled['assembly']['output_mp4_path']).exists())
        self.assertTrue(Path(assembled['captions']['srt_path']).exists())



    def test_v040_marketing_short_films_module_hook_first_cuts_and_assembly(self):
        p = self.project('video')
        mfilm = self.studio.call('create_marketing_short_film', dict(
            project_id=p['id'],
            title='Insert Treat To Continue — 60s Brand Anthem Spot',
            campaign_type='ad_narrative_spot',
            target_duration_seconds=60.0,
            opening_hook_line='Stop buying forgettable pet shirts that fade after two washes.',
            call_to_action='Upload your pet photo at custompetportraitstudio.com',
            cta_placement='hook_mid_and_end',
            brand_voice='Bold, warm, proof-driven, zero fluff',
            tone_controls='1989 16-bit arcade nostalgia meets soft Washed Sage & Heather Gray Comfort Colors 1717 luxury',
            audience_targeting_notes='Dog & cat owners shopping for memorable holiday gifts; pain point: generic clip-art pet merch',
            hook_first_ordering=True,
            primary_aspect_ratio='9:16',
            platform_cuts=['9:16', '16:9', '1:1', '4:5'],
        ))
        self.assertEqual(mfilm['module_name'], 'Marketing Short Films')
        self.assertAlmostEqual(mfilm['total_planned_duration_seconds'], 60.0, places=1)
        self.assertTrue(mfilm['hook_first_ordering'])
        self.assertIn('Hook-First', mfilm['scenes'][0]['stage'])
        self.assertEqual(mfilm['scenes'][0]['cta_overlay'], 'Upload your pet photo at custompetportraitstudio.com')
        self.assertIn('9:16', mfilm['platform_native_cuts'])
        self.assertIn('16:9', mfilm['platform_native_cuts'])
        self.assertEqual(mfilm['platform_native_cuts']['9:16']['cut_name'], 'vertical_social')
        self.assertEqual(mfilm['platform_native_cuts']['16:9']['cut_name'], 'horizontal_web')

        listed = self.studio.call('list_marketing_short_films', {'project_id': p['id']})['marketing_short_films']
        self.assertEqual(len(listed), 1)

        # Create a compact 30s marketing spot with 3 fast scenes and render both 9:16 vertical and 16:9 horizontal cuts
        fast_mfilm = self.studio.call('create_marketing_short_film', dict(
            project_id=p['id'],
            title='30s Rapid Promo Spot',
            campaign_type='product_promo_film',
            target_duration_seconds=30.0,
            opening_hook_line='Turn your dog into a 16-bit arcade legend in 60 seconds.',
            call_to_action='Order yours at custompetportraitstudio.com',
            cta_placement='mid_and_end',
            brand_voice='Punchy, joyful, conversion-focused',
            tone_controls='High-contrast neon arcade energy',
            audience_targeting_notes='Pet parents and gift buyers',
            primary_aspect_ratio='9:16',
            scenes=[
                {'stage': 'Hook', 'media_type': 'video', 'duration_seconds': 1.5, 'camera_motion': 'whip_pan', 'voiceover_or_dialogue': 'Turn your dog into a 16-bit legend.'},
                {'stage': 'Product Proof Still', 'media_type': 'image', 'duration_seconds': 1.5, 'camera_motion': 'push_in', 'voiceover_or_dialogue': 'Printed on Washed Sage Comfort Colors 1717.'},
                {'stage': 'CTA End Card', 'media_type': 'video', 'duration_seconds': 1.5, 'camera_motion': 'locked_off_static', 'voiceover_or_dialogue': 'Order yours today.'},
            ],
        ))
        vert_cut = self.studio.call('assemble_marketing_short_film', dict(
            project_id=p['id'],
            marketing_film_id=fast_mfilm['id'],
            cut_aspect_ratio='9:16',
            transition_type='fade',
            transition_duration_seconds=0.5,
            execute_render=True,
        ))
        self.assertEqual(vert_cut['cut_aspect_ratio'], '9:16')
        self.assertTrue(vert_cut['assembly']['rendered'])
        self.assertTrue(Path(vert_cut['assembly']['output_mp4_path']).exists())
        self.assertEqual(vert_cut['assembly']['camera_motions_applied'], ['whip_pan', 'push_in', 'locked_off_static'])

        horiz_cut = self.studio.call('assemble_marketing_short_film', dict(
            project_id=p['id'],
            marketing_film_id=fast_mfilm['id'],
            cut_aspect_ratio='16:9',
            transition_type='dissolve',
            transition_duration_seconds=0.5,
            execute_render=True,
        ))
        self.assertEqual(horiz_cut['cut_aspect_ratio'], '16:9')
        self.assertTrue(horiz_cut['assembly']['rendered'])
        self.assertIn('9:16', horiz_cut['marketing_short_film']['assembled_cuts'])
        self.assertIn('16:9', horiz_cut['marketing_short_film']['assembled_cuts'])

    def test_v040_mirroring_masterpieces_screenplay_reference_dna_and_camera_motions(self):
        p = self.project('video')

        # 1. Verify built-in reference masterpieces and all 19 professional camera motions
        catalog = self.studio.call('list_reference_masterpieces', {'project_id': p['id']})
        self.assertEqual(catalog['module_name'], 'Mirroring Masterpieces')
        self.assertGreaterEqual(len(catalog['built_in_masterpieces']), 8)
        expected_19_moves = [
            'dolly_zoom', 'tracking_shot', 'crane_reveal', 'handheld_tension',
            'locked_off_static', 'whip_pan', 'steadicam_oner', 'rack_focus',
            'push_in', 'pull_back', 'orbit_shot', 'parallax_glide',
            'dutch_angle', 'over_the_shoulder', 'point_of_view', 'aerial_drone',
            'time_lapse', 'slow_motion', 'speed_ramp',
        ]
        for move in expected_19_moves:
            self.assertIn(move, catalog['professional_camera_motions'])

        # 2. Register a custom Fred-approved reference film in Mirroring Masterpieces
        custom_ref = self.studio.call('register_reference_masterpiece', dict(
            project_id=p['id'],
            title='Blade Runner 2049 (2017)',
            genre_archetype='Atmospheric Neo-Noir Philosophical Sci-Fi Epic',
            structural_dna='Slow-burn investigative mystery unfolding across monumental brutalist landscapes toward an intimate emotional sacrifice.',
            pacing_cadence='Hypnotic, deliberate visual breathing room punctuated by sudden visceral impact.',
            character_arc_model='Searcher discovers that humanity is defined by selfless choice rather than origin.',
            dialogue_mechanics='Sparse, resonant, subtext-laden exchanges where silence speaks volumes.',
            thematic_techniques='Amber desert haze, towering monolithic scale, volumetric light shafts, and acoustic bass pulse.',
            signature_camera_motions=['aerial_drone', 'push_in', 'parallax_glide', 'dolly_zoom', 'locked_off_static'],
        ))
        self.assertEqual(custom_ref['module_name'], 'Mirroring Masterpieces')
        self.assertIn('uncopyrightable storytelling DNA', custom_ref['ip_guardrail_notice'])

        # 3. Create a full-length feature screenplay in Mirroring Masterpieces with custom camera moves
        chosen_moves = [
            'crane_reveal', 'tracking_shot', 'over_the_shoulder', 'rack_focus',
            'dolly_zoom', 'steadicam_oner', 'whip_pan', 'pull_back',
        ]
        screenplay = self.studio.call('create_mirroring_masterpiece_screenplay', dict(
            project_id=p['id'],
            title='The Sovereign Ledger',
            logline='An architect of forgotten corporate relics discovers a decades-old Wyoming charter that holds the key to rebuilding a community empire.',
            genre='Neo-Noir Financial & Legacy Drama',
            structure_model='three_act_feature',
            target_duration_seconds=5400.0,  # 90-minute feature screenplay
            reference_masterpieces=['the_godfather_1972', 'the_dark_knight_2008', custom_ref['id']],
            world_building_notes='Nocturnal glass-and-mahogany boardrooms contrasted with sunlit Cheyenne archive vaults; deep navy #071120 and warm gold #FFD700 palette.',
            characters=[
                {
                    'name': 'Marcus Vance',
                    'role': 'protagonist',
                    'visual_dna': 'Sharp-eyed strategist in a tailored charcoal coat with a vintage brass compass',
                    'internal_flaw_need': 'Believes he must carry every burden alone before learning to trust an alliance',
                    'external_want': 'Secure the sovereign charter before the conglomerate liquidates the town',
                    'character_arc': 'Reluctant solitary tactician transforms into the founding architect of a shared empire',
                },
                {
                    'name': 'Elena Rostova',
                    'role': 'deuteragonist',
                    'visual_dna': 'Forensic archivist with emerald scarf and razor-sharp recall',
                    'internal_flaw_need': 'Guarded cynic who has seen too many promises broken',
                    'external_want': 'Expose the hidden provenance of the 1998 ledger',
                    'character_arc': 'Becomes the co-architect and moral compass of the new venture',
                },
            ],
            scene_camera_motions=chosen_moves,
            aspect_ratio='16:9',
        ))
        self.assertEqual(screenplay['module_name'], 'Mirroring Masterpieces')
        self.assertEqual(screenplay['title'], 'The Sovereign Ledger')
        self.assertEqual(screenplay['scene_count'], 8)
        self.assertEqual(screenplay['scene_camera_motions'], chosen_moves)
        self.assertEqual(len(screenplay['reference_masterpieces']), 3)
        self.assertTrue(Path(screenplay['screenplay_file_path']).exists())
        fountain_text = screenplay['formatted_screenplay_text']
        self.assertIn('FADE IN:', fountain_text)
        self.assertIn('EXT.', fountain_text)
        self.assertIn('INT.', fountain_text)
        self.assertIn('MARCUS VANCE', fountain_text)
        self.assertIn('[CAMERA MOTION: DOLLY_ZOOM', fountain_text)
        self.assertIn('FADE OUT.', fountain_text)

        sp_list = self.studio.call('list_mirroring_masterpiece_screenplays', {'project_id': p['id']})['mirroring_masterpieces']
        self.assertEqual(len(sp_list), 1)

        # 4. Break selected scenes (scenes 1, 4, 5) into video/image shots and assemble via assemble_video_clips with real FFmpeg rendering
        assembled_sp = self.studio.call('assemble_mirroring_masterpiece_scenes', dict(
            project_id=p['id'],
            screenplay_id=screenplay['id'],
            scene_numbers=[1, 4, 5],
            per_scene_duration_override_seconds=1.5,
            transition_type='dissolve',
            transition_duration_seconds=0.5,
            execute_render=True,
        ))
        self.assertEqual(assembled_sp['module_name'], 'Mirroring Masterpieces')
        self.assertEqual(assembled_sp['assembled_scene_numbers'], [1, 4, 5])
        self.assertEqual(
            assembled_sp['camera_motions_carried_to_video'],
            ['crane_reveal', 'rack_focus', 'dolly_zoom'],
        )
        self.assertTrue(assembled_sp['assembly']['rendered'])
        self.assertTrue(Path(assembled_sp['assembly']['output_mp4_path']).exists())
        self.assertTrue(Path(assembled_sp['captions']['srt_path']).exists())
        # Verify the time-varying camera motion chains are embedded in the executed filter_complex
        fc = assembled_sp['assembly']['filter_complex']
        self.assertIn('zoompan=', fc)  # crane_reveal / dolly_zoom
        self.assertIn("gblur=sigma=2.5:enable='lt(t,", fc)  # rack_focus pull
        self.assertTrue(assembled_sp['assembly']['captions_burned_in'])

    # --- v0.4.1 fixes -----------------------------------------------------------

    def gray_frame(self, path, t, size='64x36'):
        return subprocess.run(
            ['ffmpeg', '-v', 'error', '-ss', str(t), '-i', str(path), '-frames:v', '1',
             '-vf', f'scale={size.replace("x", ":")},format=gray', '-f', 'rawvideo', '-'],
            capture_output=True, check=True).stdout

    @staticmethod
    def frame_diff(a, b):
        return sum(abs(x - y) for x, y in zip(a, b)) / len(a)

    def lavfi_file(self, name, source, *extra):
        path = Path(self.temp.name) / name
        subprocess.run(['ffmpeg', '-y', '-f', 'lavfi', '-i', source, *extra, str(path)],
                       capture_output=True, check=True)
        return path

    def test_v041_camera_motions_move_the_frame_over_time(self):
        p = self.project('video')
        still = self.lavfi_file('still.png', 'testsrc=s=640x360:d=1', '-frames:v', '1')
        speed_moves = {'time_lapse', 'slow_motion', 'speed_ramp'}
        for move in list(PROFESSIONAL_CAMERA_MOTIONS)[:19]:
            with self.subTest(move=move):
                out = self.studio.call('assemble_video_clips', dict(
                    project_id=p['id'], aspect_ratio='16:9', execute_render=True,
                    clips=[{'path': str(still), 'duration_seconds': 2.0, 'camera_motion': move}],
                ))['output_mp4_path']
                change = self.frame_diff(self.gray_frame(out, 0.05), self.gray_frame(out, 1.9))
                if move == 'locked_off_static' or move in speed_moves:
                    self.assertLess(change, 1.0)  # a still image has nothing to speed up
                else:
                    self.assertGreater(change, 2.0)

        # Speed moves retime real footage: slow motion shows source time t/2 at output time t.
        moving = self.lavfi_file('moving.mp4', 'testsrc2=s=640x360:r=24:d=4', '-pix_fmt', 'yuv420p')
        slow = self.studio.call('assemble_video_clips', dict(
            project_id=p['id'], aspect_ratio='16:9', execute_render=True,
            clips=[{'path': str(moving), 'duration_seconds': 2.0, 'camera_motion': 'slow_motion'}],
        ))['output_mp4_path']
        out_frame = self.gray_frame(slow, 1.0)
        self.assertLess(self.frame_diff(out_frame, self.gray_frame(moving, 0.5)), 1.0)
        self.assertGreater(self.frame_diff(out_frame, self.gray_frame(moving, 1.0)), 2.0)

    def test_v041_captions_are_burned_into_the_picture(self):
        p = self.project('video')
        black = self.lavfi_file('black.mp4', 'color=c=black:s=640x360:r=24:d=2', '-pix_fmt', 'yuv420p')
        srt = Path(self.temp.name) / 'line.srt'
        srt.write_text('1\n00:00:00,000 --> 00:00:02,000\nHELLO WORLD CAPTION\n', encoding='utf-8')
        base = dict(project_id=p['id'], aspect_ratio='16:9', execute_render=True,
                    clips=[{'path': str(black)}], srt_caption_path=str(srt))
        burned = self.studio.call('assemble_video_clips', base)
        plain = self.studio.call('assemble_video_clips', dict(base, burn_in_captions=False))
        self.assertTrue(burned['captions_burned_in'])
        self.assertFalse(plain['captions_burned_in'])
        self.assertIn('subtitles=', burned['filter_complex'])
        self.assertNotIn('subtitles=', plain['filter_complex'])
        # Only the captioned render has bright text pixels on the black frame.
        self.assertGreater(max(self.gray_frame(burned['output_mp4_path'], 1.0, '320x180')), 150)
        self.assertLess(max(self.gray_frame(plain['output_mp4_path'], 1.0, '320x180')), 40)

        with self.assertRaisesRegex(ValueError, 'srt_caption_path not found'):
            self.studio.call('assemble_video_clips', dict(base, srt_caption_path=str(srt) + '.missing'))

    def test_v041_screenplay_structure_models_differ(self):
        p = self.project('video')
        results = {}
        for model in ('three_act_feature', 'five_act_dramatic', 'eight_sequence_cinema'):
            results[model] = self.studio.call('create_mirroring_masterpiece_screenplay', dict(
                project_id=p['id'], title='Same Story', logline='A founder rebuilds a legacy.',
                genre='Drama', structure_model=model, target_duration_seconds=4800.0,
                reference_masterpieces=['the_godfather_1972'], world_building_notes='Cheyenne archives',
                characters=[{'name': 'Marcus', 'visual_dna': 'charcoal coat'}],
            ))
        acts = {m: {label.split(' — ')[0] for label in r['act_structure']} for m, r in results.items()}
        self.assertEqual(acts['three_act_feature'], {'ACT I', 'ACT II', 'ACT III'})
        self.assertEqual(acts['five_act_dramatic'], {'ACT I', 'ACT II', 'ACT III', 'ACT IV', 'ACT V'})
        self.assertEqual(len(results['eight_sequence_cinema']['act_structure']), 8)
        self.assertEqual({s['duration_seconds'] for s in results['eight_sequence_cinema']['scenes']}, {600.0})
        self.assertNotEqual(results['three_act_feature']['scenes'][4]['duration_seconds'],
                            results['five_act_dramatic']['scenes'][4]['duration_seconds'])
        for r in results.values():
            self.assertAlmostEqual(r['total_planned_duration_seconds'], 4800.0, places=1)
            self.assertIn(f"# {r['act_structure'][-1]}", r['formatted_screenplay_text'])
        self.assertEqual(len({r['formatted_screenplay_text'].split('FADE IN:')[1] for r in results.values()}), 3)

    def test_v041_short_film_range_real_media_and_camera_motions(self):
        p = self.project('video')
        base = dict(project_id=p['id'], title='Range', logline='A tailor finds purpose.', genre='Drama',
                    characters=[{'name': 'Ana', 'visual_dna': 'green apron'}])
        for bad in (59.0, 301.0):
            with self.assertRaisesRegex(ValueError, 'target_duration_seconds'):
                self.studio.call('create_short_film', dict(base, target_duration_seconds=bad))
        for ok in (60.0, 300.0):
            self.assertAlmostEqual(self.studio.call('create_short_film', dict(
                base, target_duration_seconds=ok))['total_planned_duration_seconds'], ok, places=1)

        # Supplied media is used as-is; only scenes without media_path become placeholder cards,
        # and each shot's camera_motion reaches the assembler.
        footage = self.lavfi_file('footage.mp4', 'testsrc2=s=640x360:r=24:d=2', '-pix_fmt', 'yuv420p')
        film = self.studio.call('create_short_film', dict(base, target_duration_seconds=60.0, acts=[
            {'act': 'Act I', 'duration_seconds': 2.0, 'camera_motion': 'crane_reveal', 'media_path': str(footage)},
            {'act': 'Act II', 'duration_seconds': 2.0, 'camera_motion': 'whip_pan', 'media_type': 'image'},
        ]))
        assembled = self.studio.call('assemble_short_film', dict(
            project_id=p['id'], film_id=film['id'], transition_duration_seconds=0.5, execute_render=True))
        assembly = assembled['assembly']
        self.assertEqual(assembly['camera_motions_applied'], ['crane_reveal', 'whip_pan'])
        self.assertEqual([t['is_placeholder'] for t in assembly['timeline']], [False, True])
        self.assertEqual(assembly['placeholder_clip_count'], 1)
        self.assertEqual(assembly['timeline'][0]['path'], str(footage.resolve()))
        # Captions are timed to the assembled runtime (transitions overlap neighbouring shots).
        self.assertAlmostEqual(assembled['captions']['total_duration_seconds'], 3.5, places=2)
        self.assertAlmostEqual(assembly['total_output_duration_seconds'], 3.5, places=2)

        with self.assertRaisesRegex(ValueError, 'media file not found'):
            self.studio.call('assemble_video_clips', dict(
                project_id=p['id'], execute_render=True, clips=[{'path': str(footage) + '.missing'}]))



    def test_v041_estimated_screenplay_pages_tracks_text_length_not_runtime(self):
        p = self.project('video')
        sp_short_text_long_runtime = self.studio.call('create_mirroring_masterpiece_screenplay', dict(
            project_id=p['id'],
            title='Silent Horizon',
            logline='A lone watchkeeper waits out a 90-minute storm across eight sequences.',
            genre='Drama',
            target_duration_seconds=5400.0,
            reference_masterpieces=['the_godfather_1972'],
            world_building_notes='Cheyenne archives',
            characters=[{'name': 'Marcus', 'visual_dna': 'charcoal coat'}],
        ))
        self.assertEqual(sp_short_text_long_runtime['target_runtime_minutes'], 90.0)
        self.assertLess(sp_short_text_long_runtime['estimated_screenplay_pages'], 10.0)
        self.assertGreaterEqual(sp_short_text_long_runtime['estimated_screenplay_pages'], 1.0)


if __name__ == '__main__':
    unittest.main()
