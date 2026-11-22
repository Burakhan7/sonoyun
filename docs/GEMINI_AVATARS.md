# Gemini avatar istemleri

24 hayvan avatarı, hepsi aynı stilde. İstemler İngilizce, çünkü görsel modelleri İngilizce istemde stili daha tutarlı uyguluyor.

## Nasıl üretilir (tutarlılık için sıra önemli)

1. Gemini'de (görsel üretimi açık modelle) **yeni bir sohbet** aç.
2. Önce **Ana stil istemi + `kartal` satırını** gönder. Beğenene kadar yeniden üret. Bu görsel **stil referansın** olacak.
3. Beğendiğin kartal görselini indir. Sonraki her hayvan için **aynı sohbette** kartal görselini ekleyip **"Referans istemi" + o hayvanın satırını** gönder. Böylece çizgi kalınlığı, ışık ve oranlar sabit kalır.
4. Her görseli `{id}.png` adıyla kaydet (ör. `tilki.png`) ve `apps/web/public/avatars/raw/` klasörüne koy.
5. `pnpm tsx scripts/optimize-avatars.ts` → 256 ve 512 px webp dosyaları üretilir.

## Kabul kontrol listesi

- [ ] Kare (1:1), en az 1024×1024
- [ ] Arka plan **tek düz renk** (tablodaki hex), gölge/desen/zemin çizgisi yok
- [ ] Sadece baş ve omuzlar, hayvan ortada, kenarlardan en az %12 boşluk (daire içinde kırpılınca kulak/boynuz kesilmemeli)
- [ ] Yazı, harf, logo, filigran yok
- [ ] Diğer avatarlarla aynı çizgi kalınlığı ve renk doygunluğu
- [ ] 48 px'e küçültünce hâlâ hangi hayvan olduğu anlaşılıyor

## Ana stil istemi (ilk görsel için)

```
Create a single square 1:1 avatar illustration for a friendly social game website.
Style: modern flat vector illustration with soft subtle shading, clean rounded shapes, consistent medium-thick dark brown outlines (#3B2F2A), warm pastel palette, cute but not childish, slightly playful personality. Front-facing head and shoulders only, centered, with generous empty margin around the subject so it can be cropped into a circle without cutting ears or horns.
Background: one perfectly flat solid color, no gradient, no texture, no shadow, no ground line, no frame.
No text, no letters, no logo, no watermark, no border.
Subject: {SUBJECT}
Background color: {HEX}
```

## Referans istemi (sonraki 23 görsel için, kartal görselini ekleyerek)

```
Using the attached image as the exact style reference, create a new avatar in the same illustration style: same outline thickness and color, same shading, same proportions and head-and-shoulders framing, same level of detail and the same amount of empty margin. Square 1:1.
Background: one perfectly flat solid color, no gradient, no texture, no shadow.
No text, no letters, no logo, no watermark, no border.
Subject: {SUBJECT}
Background color: {HEX}
```

## Hayvanlar

`{SUBJECT}` ve `{HEX}` yerine aşağıdaki satırları koy.

| Dosya | Hayvan | {SUBJECT} | {HEX} |
|---|---|---|---|
| `kartal.png` | Kartal | a cute bald eagle, proud chest-out pose, small confident smirk | `#F4C98B` |
| `tilki.png` | Tilki | a cute red fox, sly playful grin, one ear slightly tilted | `#F7B9A0` |
| `baykus.png` | Baykuş | a cute owl, big round curious eyes, tiny reading glasses pushed up on its head | `#C9B8E8` |
| `kedi.png` | Kedi | a cute tabby cat, half-closed relaxed eyes, content little smile | `#FBE3A1` |
| `kopek.png` | Köpek | a cute golden retriever puppy, tongue out, happy open-mouth smile | `#BFE3C6` |
| `panda.png` | Panda | a cute giant panda, sleepy cheerful face, holding a small bamboo leaf | `#CDE7F0` |
| `aslan.png` | Aslan | a cute lion, fluffy mane, warm friendly smile | `#F9D58A` |
| `kaplan.png` | Kaplan | a cute tiger, bold stripes, excited wide eyes | `#F7C6A3` |
| `ayi.png` | Ayı | a cute brown bear, soft cozy expression, rosy cheeks | `#E2CDB5` |
| `tavsan.png` | Tavşan | a cute rabbit, long ears up, shy happy look | `#F6CFE0` |
| `kirpi.png` | Kirpi | a cute hedgehog, tiny nose, cheerful squint | `#E8D9B0` |
| `sincap.png` | Sincap | a cute red squirrel, bushy tail curled beside its head, holding an acorn | `#F3C1A0` |
| `penguen.png` | Penguen | a cute penguin, waddle-ready stance, cheeky smile | `#BCD8F2` |
| `yunus.png` | Yunus | a cute dolphin, playful smile, small water splash | `#A9DDF0` |
| `ahtapot.png` | Ahtapot | a cute octopus, one tentacle waving hello, friendly eyes | `#F2B8C6` |
| `kaplumbaga.png` | Kaplumbağa | a cute turtle, calm wise expression, patterned shell visible at the bottom | `#C6E5B3` |
| `zurafa.png` | Zürafa | a cute giraffe, long neck leaning into frame, curious look | `#F8DDA0` |
| `fil.png` | Fil | a cute baby elephant, trunk raised happily, big ears | `#D3D9E8` |
| `koala.png` | Koala | a cute koala, fluffy ears, drowsy smile | `#D6E3D1` |
| `rakun.png` | Rakun | a cute raccoon, mischievous grin, mask-like face pattern | `#D9D2C5` |
| `kurbaga.png` | Kurbağa | a cute frog, big goofy smile, wide eyes | `#CBEBA6` |
| `papagan.png` | Papağan | a cute parrot, colorful feathers, chatty open beak | `#B8E6D4` |
| `flamingo.png` | Flamingo | a cute flamingo, elegant curved neck, playful wink | `#F9C5D1` |
| `geyik.png` | Geyik | a cute deer, small antlers, gentle kind eyes | `#E9CFAE` |

## Hazır istemler (kopyala-yapıştır)

Aşağıdaki bloklarda değişkenler doldurulmuş durumda. İlk blok ana stil istemiyle, diğerleri referans istemiyle (kartal görseli ekli olarak) gönderilir.

### 1. Kartal → `kartal.png` (ana stil istemi)

```
Create a single square 1:1 avatar illustration for a friendly social game website.
Style: modern flat vector illustration with soft subtle shading, clean rounded shapes, consistent medium-thick dark brown outlines (#3B2F2A), warm pastel palette, cute but not childish, slightly playful personality. Front-facing head and shoulders only, centered, with generous empty margin around the subject so it can be cropped into a circle without cutting ears or horns.
Background: one perfectly flat solid color, no gradient, no texture, no shadow, no ground line, no frame.
No text, no letters, no logo, no watermark, no border.
Subject: a cute bald eagle, proud chest-out pose, small confident smirk
Background color: #F4C98B
```

### 2. Tilki → `tilki.png` (referans istemi, kartal görseli ekli)

```
Using the attached image as the exact style reference, create a new avatar in the same illustration style: same outline thickness and color, same shading, same proportions and head-and-shoulders framing, same level of detail and the same amount of empty margin. Square 1:1.
Background: one perfectly flat solid color, no gradient, no texture, no shadow.
No text, no letters, no logo, no watermark, no border.
Subject: a cute red fox, sly playful grin, one ear slightly tilted
Background color: #F7B9A0
```

### 3. Baykuş → `baykus.png` (referans istemi, kartal görseli ekli)

```
Using the attached image as the exact style reference, create a new avatar in the same illustration style: same outline thickness and color, same shading, same proportions and head-and-shoulders framing, same level of detail and the same amount of empty margin. Square 1:1.
Background: one perfectly flat solid color, no gradient, no texture, no shadow.
No text, no letters, no logo, no watermark, no border.
Subject: a cute owl, big round curious eyes, tiny reading glasses pushed up on its head
Background color: #C9B8E8
```

### 4. Kedi → `kedi.png` (referans istemi, kartal görseli ekli)

```
Using the attached image as the exact style reference, create a new avatar in the same illustration style: same outline thickness and color, same shading, same proportions and head-and-shoulders framing, same level of detail and the same amount of empty margin. Square 1:1.
Background: one perfectly flat solid color, no gradient, no texture, no shadow.
No text, no letters, no logo, no watermark, no border.
Subject: a cute tabby cat, half-closed relaxed eyes, content little smile
Background color: #FBE3A1
```

### 5. Köpek → `kopek.png` (referans istemi, kartal görseli ekli)

```
Using the attached image as the exact style reference, create a new avatar in the same illustration style: same outline thickness and color, same shading, same proportions and head-and-shoulders framing, same level of detail and the same amount of empty margin. Square 1:1.
Background: one perfectly flat solid color, no gradient, no texture, no shadow.
No text, no letters, no logo, no watermark, no border.
Subject: a cute golden retriever puppy, tongue out, happy open-mouth smile
Background color: #BFE3C6
```

### 6. Panda → `panda.png` (referans istemi, kartal görseli ekli)

```
Using the attached image as the exact style reference, create a new avatar in the same illustration style: same outline thickness and color, same shading, same proportions and head-and-shoulders framing, same level of detail and the same amount of empty margin. Square 1:1.
Background: one perfectly flat solid color, no gradient, no texture, no shadow.
No text, no letters, no logo, no watermark, no border.
Subject: a cute giant panda, sleepy cheerful face, holding a small bamboo leaf
Background color: #CDE7F0
```

### 7. Aslan → `aslan.png` (referans istemi, kartal görseli ekli)

```
Using the attached image as the exact style reference, create a new avatar in the same illustration style: same outline thickness and color, same shading, same proportions and head-and-shoulders framing, same level of detail and the same amount of empty margin. Square 1:1.
Background: one perfectly flat solid color, no gradient, no texture, no shadow.
No text, no letters, no logo, no watermark, no border.
Subject: a cute lion, fluffy mane, warm friendly smile
Background color: #F9D58A
```

### 8. Kaplan → `kaplan.png` (referans istemi, kartal görseli ekli)

```
Using the attached image as the exact style reference, create a new avatar in the same illustration style: same outline thickness and color, same shading, same proportions and head-and-shoulders framing, same level of detail and the same amount of empty margin. Square 1:1.
Background: one perfectly flat solid color, no gradient, no texture, no shadow.
No text, no letters, no logo, no watermark, no border.
Subject: a cute tiger, bold stripes, excited wide eyes
Background color: #F7C6A3
```

### 9. Ayı → `ayi.png` (referans istemi, kartal görseli ekli)

```
Using the attached image as the exact style reference, create a new avatar in the same illustration style: same outline thickness and color, same shading, same proportions and head-and-shoulders framing, same level of detail and the same amount of empty margin. Square 1:1.
Background: one perfectly flat solid color, no gradient, no texture, no shadow.
No text, no letters, no logo, no watermark, no border.
Subject: a cute brown bear, soft cozy expression, rosy cheeks
Background color: #E2CDB5
```

### 10. Tavşan → `tavsan.png` (referans istemi, kartal görseli ekli)

```
Using the attached image as the exact style reference, create a new avatar in the same illustration style: same outline thickness and color, same shading, same proportions and head-and-shoulders framing, same level of detail and the same amount of empty margin. Square 1:1.
Background: one perfectly flat solid color, no gradient, no texture, no shadow.
No text, no letters, no logo, no watermark, no border.
Subject: a cute rabbit, long ears up, shy happy look
Background color: #F6CFE0
```

### 11. Kirpi → `kirpi.png` (referans istemi, kartal görseli ekli)

```
Using the attached image as the exact style reference, create a new avatar in the same illustration style: same outline thickness and color, same shading, same proportions and head-and-shoulders framing, same level of detail and the same amount of empty margin. Square 1:1.
Background: one perfectly flat solid color, no gradient, no texture, no shadow.
No text, no letters, no logo, no watermark, no border.
Subject: a cute hedgehog, tiny nose, cheerful squint
Background color: #E8D9B0
```

### 12. Sincap → `sincap.png` (referans istemi, kartal görseli ekli)

```
Using the attached image as the exact style reference, create a new avatar in the same illustration style: same outline thickness and color, same shading, same proportions and head-and-shoulders framing, same level of detail and the same amount of empty margin. Square 1:1.
Background: one perfectly flat solid color, no gradient, no texture, no shadow.
No text, no letters, no logo, no watermark, no border.
Subject: a cute red squirrel, bushy tail curled beside its head, holding an acorn
Background color: #F3C1A0
```

### 13. Penguen → `penguen.png` (referans istemi, kartal görseli ekli)

```
Using the attached image as the exact style reference, create a new avatar in the same illustration style: same outline thickness and color, same shading, same proportions and head-and-shoulders framing, same level of detail and the same amount of empty margin. Square 1:1.
Background: one perfectly flat solid color, no gradient, no texture, no shadow.
No text, no letters, no logo, no watermark, no border.
Subject: a cute penguin, waddle-ready stance, cheeky smile
Background color: #BCD8F2
```

### 14. Yunus → `yunus.png` (referans istemi, kartal görseli ekli)

```
Using the attached image as the exact style reference, create a new avatar in the same illustration style: same outline thickness and color, same shading, same proportions and head-and-shoulders framing, same level of detail and the same amount of empty margin. Square 1:1.
Background: one perfectly flat solid color, no gradient, no texture, no shadow.
No text, no letters, no logo, no watermark, no border.
Subject: a cute dolphin, playful smile, small water splash
Background color: #A9DDF0
```

### 15. Ahtapot → `ahtapot.png` (referans istemi, kartal görseli ekli)

```
Using the attached image as the exact style reference, create a new avatar in the same illustration style: same outline thickness and color, same shading, same proportions and head-and-shoulders framing, same level of detail and the same amount of empty margin. Square 1:1.
Background: one perfectly flat solid color, no gradient, no texture, no shadow.
No text, no letters, no logo, no watermark, no border.
Subject: a cute octopus, one tentacle waving hello, friendly eyes
Background color: #F2B8C6
```

### 16. Kaplumbağa → `kaplumbaga.png` (referans istemi, kartal görseli ekli)

```
Using the attached image as the exact style reference, create a new avatar in the same illustration style: same outline thickness and color, same shading, same proportions and head-and-shoulders framing, same level of detail and the same amount of empty margin. Square 1:1.
Background: one perfectly flat solid color, no gradient, no texture, no shadow.
No text, no letters, no logo, no watermark, no border.
Subject: a cute turtle, calm wise expression, patterned shell visible at the bottom
Background color: #C6E5B3
```

### 17. Zürafa → `zurafa.png` (referans istemi, kartal görseli ekli)

```
Using the attached image as the exact style reference, create a new avatar in the same illustration style: same outline thickness and color, same shading, same proportions and head-and-shoulders framing, same level of detail and the same amount of empty margin. Square 1:1.
Background: one perfectly flat solid color, no gradient, no texture, no shadow.
No text, no letters, no logo, no watermark, no border.
Subject: a cute giraffe, long neck leaning into frame, curious look
Background color: #F8DDA0
```

### 18. Fil → `fil.png` (referans istemi, kartal görseli ekli)

```
Using the attached image as the exact style reference, create a new avatar in the same illustration style: same outline thickness and color, same shading, same proportions and head-and-shoulders framing, same level of detail and the same amount of empty margin. Square 1:1.
Background: one perfectly flat solid color, no gradient, no texture, no shadow.
No text, no letters, no logo, no watermark, no border.
Subject: a cute baby elephant, trunk raised happily, big ears
Background color: #D3D9E8
```

### 19. Koala → `koala.png` (referans istemi, kartal görseli ekli)

```
Using the attached image as the exact style reference, create a new avatar in the same illustration style: same outline thickness and color, same shading, same proportions and head-and-shoulders framing, same level of detail and the same amount of empty margin. Square 1:1.
Background: one perfectly flat solid color, no gradient, no texture, no shadow.
No text, no letters, no logo, no watermark, no border.
Subject: a cute koala, fluffy ears, drowsy smile
Background color: #D6E3D1
```

### 20. Rakun → `rakun.png` (referans istemi, kartal görseli ekli)

```
Using the attached image as the exact style reference, create a new avatar in the same illustration style: same outline thickness and color, same shading, same proportions and head-and-shoulders framing, same level of detail and the same amount of empty margin. Square 1:1.
Background: one perfectly flat solid color, no gradient, no texture, no shadow.
No text, no letters, no logo, no watermark, no border.
Subject: a cute raccoon, mischievous grin, mask-like face pattern
Background color: #D9D2C5
```

### 21. Kurbağa → `kurbaga.png` (referans istemi, kartal görseli ekli)

```
Using the attached image as the exact style reference, create a new avatar in the same illustration style: same outline thickness and color, same shading, same proportions and head-and-shoulders framing, same level of detail and the same amount of empty margin. Square 1:1.
Background: one perfectly flat solid color, no gradient, no texture, no shadow.
No text, no letters, no logo, no watermark, no border.
Subject: a cute frog, big goofy smile, wide eyes
Background color: #CBEBA6
```

### 22. Papağan → `papagan.png` (referans istemi, kartal görseli ekli)

```
Using the attached image as the exact style reference, create a new avatar in the same illustration style: same outline thickness and color, same shading, same proportions and head-and-shoulders framing, same level of detail and the same amount of empty margin. Square 1:1.
Background: one perfectly flat solid color, no gradient, no texture, no shadow.
No text, no letters, no logo, no watermark, no border.
Subject: a cute parrot, colorful feathers, chatty open beak
Background color: #B8E6D4
```

### 23. Flamingo → `flamingo.png` (referans istemi, kartal görseli ekli)

```
Using the attached image as the exact style reference, create a new avatar in the same illustration style: same outline thickness and color, same shading, same proportions and head-and-shoulders framing, same level of detail and the same amount of empty margin. Square 1:1.
Background: one perfectly flat solid color, no gradient, no texture, no shadow.
No text, no letters, no logo, no watermark, no border.
Subject: a cute flamingo, elegant curved neck, playful wink
Background color: #F9C5D1
```

### 24. Geyik → `geyik.png` (referans istemi, kartal görseli ekli)

```
Using the attached image as the exact style reference, create a new avatar in the same illustration style: same outline thickness and color, same shading, same proportions and head-and-shoulders framing, same level of detail and the same amount of empty margin. Square 1:1.
Background: one perfectly flat solid color, no gradient, no texture, no shadow.
No text, no letters, no logo, no watermark, no border.
Subject: a cute deer, small antlers, gentle kind eyes
Background color: #E9CFAE
```

## İsteğe bağlı: sosyal paylaşım ve logo görselleri

Aynı sohbette, kartal referansıyla:

```
Using the attached image as the style reference, create a wide 1200x630 banner illustration: a group of 6 of these animal characters (eagle, fox, owl, cat, panda, frog) sitting around a round table playing a card game together and laughing, warm cream background (#F8F6F1), same outline and shading style. Leave the left 40% of the image empty cream space for a title to be added later. No text, no letters, no logo.
```
