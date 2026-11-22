import json, sys, glob, re
from collections import Counter, defaultdict

CATS = [
    ("mutfak","Mutfak & Yemek","🍳"),("muzik","Müzik","🎵"),("nostalji","Nostalji (90'lar/2000'ler)","🧒"),
    ("okul","Okul & Kampüs","🎓"),("is","İş & Ofis Hayatı","💼"),("seyahat","Seyahat & Şehirler","✈️"),
    ("spor","Spor","⚽"),("hayvanlar","Evcil Hayvanlar","🐾"),("internet","İnternet & Meme Kültürü","📱"),
    ("sehir","Şehir & Toplu Taşıma","🚌"),("kultur","Türk Kültürü & Gelenekler","🎉"),("alisveris","Alışveriş & Para","🛒"),
    ("gece","Gece & Alışkanlıklar","🌙"),("yasaydi","Ya Şöyle Olsaydı?","🧠"),("dizi_film","Dizi & Film","🎬"),("oyun","Oyun Dünyası","🎮"),
]
CAT_IDS = [c[0] for c in CATS]
LEVEL = {"L":"light","P":"personal","B":"bold"}
EMOJI_PROMPT = "Bu emojiler neyi anlatıyor?"

out = {"version": 2, "categories": [{"id":i,"name":n,"emoji":e} for i,n,e in CATS], "quiz": [], "ayna": [], "cards": []}
counts = defaultdict(Counter)
errors = []
cat = None
for path in sorted(glob.glob(sys.argv[1] + "/*.txt")):
    for ln, raw in enumerate(open(path, encoding="utf-8"), 1):
        line = raw.strip()
        if not line: continue
        m = re.match(r"# cat:(\w+)", line)
        if m:
            cat = m.group(1); assert cat in CAT_IDS, cat; continue
        p = line.split("|"); t = p[0]
        where = f"{path}:{ln}"
        counts[cat][t] += 1
        n = counts[cat][t]
        try:
            if t == "M":
                assert len(p) == 6, "M needs 6 fields"
                out["quiz"].append({"id":f"{cat}-mc{n:03d}","category":cat,"type":"mc","prompt":p[1],"options":p[2:6],"answerIndex":0})
            elif t == "J":
                assert len(p) == 6, "J needs 6 fields"
                out["quiz"].append({"id":f"{cat}-em{n:03d}","category":cat,"type":"emoji","emoji":p[1],"prompt":EMOJI_PROMPT,"options":p[2:6],"answerIndex":0})
            elif t == "T":
                assert len(p) == 3 and p[2] in ("0","1"), "T format"
                out["quiz"].append({"id":f"{cat}-tf{n:03d}","category":cat,"type":"tf","prompt":p[1],"answer":p[2]=="1"})
            elif t == "E":
                assert len(p) == 5, "E needs 5 fields"
                num = lambda s: float(s) if "." in s else int(s)
                out["quiz"].append({"id":f"{cat}-es{n:03d}","category":cat,"type":"estimate","prompt":p[1],"answer":num(p[2]),"tolerance":num(p[3]),"unit":p[4]})
            elif t == "A":
                assert len(p) == 3, "A needs 3 fields"
                out["ayna"].append({"id":f"{cat}-ay{n:03d}","category":cat,"a":p[1],"b":p[2]})
            elif t in LEVEL:
                assert len(p) == 2, "card needs 2 fields"
                out["cards"].append({"id":f"{cat}-{t.lower()}{n:03d}","category":cat,"level":LEVEL[t],"text":p[1]})
            else:
                raise AssertionError("unknown type " + t)
        except AssertionError as e:
            errors.append(f"{where}: {e}")

# beklenen sayılar
for c in CAT_IDS:
    exp = {"A":40,"L":10,"P":10,"B":10} if c == "yasaydi" else {"M":12,"T":12,"E":8,"J":8,"A":20,"L":10,"P":10,"B":10}
    for k, v in exp.items():
        if counts[c][k] != v: errors.append(f"{c}: {k} = {counts[c][k]} (beklenen {v})")
# şık tekrarı ve metin tekrarı
for q in out["quiz"]:
    if "options" in q and len(set(q["options"])) != 4: errors.append(f"{q['id']}: tekrarlı şık")
for key, field in (("quiz","prompt"),("cards","text")):
    dup = [x for x, k in Counter((i["category"], i[field], i.get("emoji")) for i in out[key]).items() if k > 1]
    errors += [f"tekrar {key}: {d}" for d in dup]
dup = [x for x,k in Counter((a["category"], a["a"], a["b"]) for a in out["ayna"]).items() if k > 1]
errors += [f"tekrar ayna: {d}" for d in dup]

if errors:
    print("\n".join(errors)); sys.exit(1)
json.dump(out, open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print(f"OK: {len(out['quiz'])} yarışma sorusu, {len(out['ayna'])} ayna turu, {len(out['cards'])} sohbet kartı, {len(CATS)} kategori")
