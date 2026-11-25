from pathlib import Path
import hashlib
p=Path("foggy/index.html")
raw=p.read_bytes()
sha=hashlib.sha1(b"blob "+str(len(raw)).encode()+b"\0"+raw).hexdigest()
if b'id="letterSatchel"' in raw:
    print("Already updated")
    raise SystemExit
if sha!="1dd0f3f691c023b82fa3e92b059c3938600230e3":
    raise SystemExit("Foggy source changed; aborting to preserve game")
s=raw.decode("utf-8")
def replace(old,new):
    global s
    if s.count(old)!=1: raise SystemExit(f"Expected exactly one occurrence: {old[:55]}")
    s=s.replace(old,new,1)
replace('<div id="clueFeedback" class="clue-feedback" role="status" aria-live="polite"></div></header>','<div id="clueFeedback" class="clue-feedback" role="status" aria-live="polite"></div><div id="letterSatchel" class="letter-satchel" aria-label="Letters collected"></div></header>')
replace('</style></head><body>','''.letter-satchel{display:flex;justify-content:center;align-items:center;gap:10px;flex-wrap:wrap;padding:13px 0 5px;margin:4px auto 0}.letter-satchel .letter-heading{flex-basis:100%;text-align:center;color:#e6c895;font:600 15px Georgia,serif}.letter-satchel .letter-slot{width:45px;height:54px;display:grid;place-items:center;border:1px solid #b68d53;border-radius:11px;background:linear-gradient(150deg,#253953,#101d32);color:#867760;font:700 27px Georgia,serif}.letter-satchel .letter-slot.earned{color:#ffe6a5;border-color:#ffd48a;box-shadow:0 0 15px #ffc86d33,inset 0 0 10px #ffdc6a22;background:linear-gradient(155deg,#354562,#1b2d49)}@media(max-width:520px){.letter-satchel{gap:7px}.letter-satchel .letter-slot{width:37px;height:47px;font-size:24px}}</style></head><body>''')
replace('"extra": "I have 3 clue tokens for your adventure. If you get stuck, you may spend one to ask for help."','"extra": "I have 3 clue tokens for your adventure. If you get stuck, you may spend one to ask for help. Keep every item and clue you discover — some may help you later!"')
replace("function render(){\n$('progress').innerHTML=", """function render(){
const earnedLetters = st.step>=8 ? 5 : st.step>=7 ? 4 : st.step>=6 ? 3 : st.step>=5 ? 2 : st.step>=3 ? 1 : 0;
$('letterSatchel').innerHTML='<div class="letter-heading">✦ Letters collected ✦</div>'+['F','O','G','G','Y'].map((letter,i)=>'<span class="letter-slot '+(i<earnedLetters?'earned':'')+'" aria-label="'+(i<earnedLetters?'Collected letter '+letter:'Letter not yet collected')+'">'+(i<earnedLetters?letter:'?')+'</span>').join('');
$('progress').innerHTML=""")
p.write_text(s,encoding="utf-8")
print("Foggy updated")
