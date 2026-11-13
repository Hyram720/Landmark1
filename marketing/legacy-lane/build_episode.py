"""Legacy Lane episode assembler (run inside the Higgsfield sandbox: ffmpeg, sox, fonts preinstalled).

Inputs in the working dir: scene clips (5s Kling i2v, 9:16), vo.wav (closing VO, ~16.5s), sting.wav.
Make sting.wav with:
  for n in 196 233.08 293.66 392; do sox -n -r 48000 -c 1 t$n.wav synth 3 sine $n; done
  sox -m t*.wav -c 2 chord.wav; sox chord.wav sting.wav tremolo 5 35 reverb 70 gain -n -6 fade t 0.05 3 1.8
Edit the EPISODE block at the bottom, then: python3 build_episode.py
"""
import subprocess
W,H=1076,1924
SERIF="/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf"
SANS="/usr/share/fonts/truetype/higgsfield/Montserrat-ExtraBold.ttf"
GOLD="0xD4AF37"
CLIP=5.042
VO_LEN=16.5
ENC="-r 24 -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -c:a aac -b:a 192k -ar 48000 -ac 2"
def run(c):
    r=subprocess.run(c,shell=True,capture_output=True,text=True)
    if r.returncode: print(r.stderr[-1500:]); raise SystemExit(c)
def tf(name,text):
    open(name,"w").write(text); return name
def title(out,ep):
    a=tf(out+"_a.txt","LEGACY LANE"); b=tf(out+"_b.txt",ep)
    run(f"""ffmpeg -y -f lavfi -i color=c=0x0b0b0b:s={W}x{H}:d=3 -i sting.wav -vf "drawtext=fontfile={SERIF}:textfile={a}:fontcolor={GOLD}:fontsize=120:x=(w-tw)/2:y=h*0.42:alpha='min(1,t/0.8)',drawtext=fontfile={SERIF}:textfile={b}:fontcolor=white:fontsize=52:x=(w-tw)/2:y=h*0.42+170:alpha='min(1,max(0,(t-0.6)/0.8))',fade=t=out:st=2.5:d=0.5" -af "apad" -t 3 {ENC} {out}""")
def cap(src,out,speaker,line,sting=False,vo=False):
    s=tf(out+"_s.txt",speaker); l=tf(out+"_l.txt",line)
    vf=f"drawtext=fontfile={SANS}:textfile={s}:fontcolor={GOLD}:fontsize=46:x=(w-tw)/2:y=h*0.70:box=1:boxcolor=black@0.55:boxborderw=14,drawtext=fontfile={SANS}:textfile={l}:fontcolor=white:fontsize=50:line_spacing=12:x=(w-tw)/2:y=h*0.70+90:box=1:boxcolor=black@0.55:boxborderw=18"
    if not speaker: vf=vf.split(",",1)[1].replace("h*0.70+90","h*0.72")
    if not line: vf="null"
    ins=f"-i {src}"; af="[0:a]volume=0.6[a0]"; mix="[a0]"; n=1
    if sting: ins+=" -i sting.wav"; af+=f";[{n}:a]volume=0.8[s]"; mix+="[s]"; n+=1
    if vo: ins+=" -i vo.wav"; af+=f";[{n}:a]volume=1.6[v]"; mix+="[v]"; n+=1
    af+=f";{mix}amix=inputs={n}:duration=first:normalize=0[out]" if n>1 else ";[a0]anull[out]"
    run(f"""ffmpeg -y {ins} -filter_complex "[0:v]scale={W}:{H},{vf}[vv];{af}" -map "[vv]" -map "[out]" -t {CLIP} {ENC} {out}""")
def endcard(out):
    lines=["Preserve your family's past.","Protect your family's future.","","LegacyReadyFamily.com","Start free. No credit card required."]
    d=VO_LEN-CLIP+1.0; vf=[]; y=0.36
    for i,t in enumerate(lines):
        if not t: y+=0.03; continue
        f=tf(f"{out}_{i}.txt",t)
        col=GOLD if "Legacy" in t else "white"; fs=72 if "Legacy" in t else (42 if "Start" in t else 54)
        vf.append(f"drawtext=fontfile={SERIF}:textfile={f}:fontcolor={col}:fontsize={fs}:x=(w-tw)/2:y=h*{y:.3f}:alpha='min(1,max(0,(t-{i*0.5})/0.6))'"); y+=0.06
    run(f"""ffmpeg -y -f lavfi -i color=c=0x1a0f1f:s={W}x{H}:d={d} -i vo.wav -vf "{','.join(vf)},fade=t=in:st=0:d=0.5" -af "atrim=start={CLIP},asetpts=PTS-STARTPTS,volume=1.6,apad" -t {d} {ENC} {out}""")
def concat(parts,out):
    open("list.txt","w").write("".join(f"file '{p}'\n" for p in parts))
    run(f"ffmpeg -y -f concat -safe 0 -i list.txt -c copy -movflags +faststart {out}")

# ---- EPISODE (example: Ep 5). Last scene gets vo=True so the VO starts there and runs into the end card.
if __name__=="__main__":
    title("t.mp4","Episode 5: Roots of Deception")
    scenes=[("e1.mp4","MARCUS","Mrs. Whitmore?\nI believe we're family.",False,False),
            ("e2.mp4","VICTORIA","Family? Daddy never\nmentioned you.",False,False),
            ("e3.mp4","AUNT DELORES","That Bible... I haven't seen it\nsince Mama passed.",True,False),
            ("e4.mp4","DANI","Great-Grandpa Samuel had a brother...\nand nobody ever wrote it down.",False,False),
            ("e5.mp4","ELEANOR","Isaiah's grandson...\nHarold always wondered.",True,False),
            ("e6.mp4","ELEANOR","Our stories almost got lost.\nNot anymore.",False,True)]
    parts=["t.mp4"]
    for i,(src,spk,line,st,vo) in enumerate(scenes):
        out=f"c{i}.mp4"; cap(src,out,spk,line,st,vo); parts.append(out)
    endcard("end.mp4"); parts.append("end.mp4")
    concat(parts,"LegacyLane_Episode.mp4")
