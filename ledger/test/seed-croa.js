// Test-only. Writes a cleared enrollment onto the server workspace after a save.
// Workspace PUT cannot create signature rows or signing dates.
export function seedSignedClient(workspace, clientId, extra = {}) {
  const c = (workspace.clients || []).find(x => x && x.id === clientId);
  if (!c) throw new Error('missing client ' + clientId);
  c.onboarding = Object.assign({}, c.onboarding, {
    disclosureSignedAt: '2020-01-06',
    disclosureAcknowledgedAt: '2020-01-06T15:00:00.000Z',
    contractSignedAt: '2020-01-06',
    contractSignedAtTs: '2020-01-06T16:00:00.000Z',
    cancellationWindowEndsAt: '2020-01-09',
    cancellationWindowEndsAtTs: '2020-01-10T04:59:59.999Z'
  }, extra.onboarding || {});
  workspace.signatures = workspace.signatures || [];
  if (!workspace.signatures.some(s => s && s.clientId === clientId && s.doc === 'disclosure')) {
    workspace.signatures.push({ id: 'seed-d-' + clientId, clientId, doc: 'disclosure', at: '2020-01-06T15:00:00.000Z' });
  }
  if (!workspace.signatures.some(s => s && s.clientId === clientId && s.doc === 'contract')) {
    workspace.signatures.push({ id: 'seed-c-' + clientId, clientId, doc: 'contract', at: '2020-01-06T16:00:00.000Z' });
  }
  return c;
}
