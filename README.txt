SRBSUAE — INFORMATIVNI CENTAR

Sajt: https://srbsuae.com/
Izvorni kod: https://github.com/srbsuae-spec/srbsuae-site
Objavljena grana: main
GitHub Pages objavljuje granu main; push na nju ažurira javni sajt.

LOKALNI PREGLED
U ovom folderu pokreni: python3 -m http.server 8765 --bind 127.0.0.1
Otvori http://127.0.0.1:8765/
EN / SR menja jezik. Non-paper je u assets/non-paper.pdf.

SADRŽAJ I IZVORI
Informacije o parlamentarnim izborima u Srbiji 25. oktobra 2026. godine
za državljane Srbije koji žive u UAE: pregled, dokumenti, hronologija,
FAQ i kontakt za medije. Odluka RIK-a od 5. oktobra i objava o 44.
sednici imaju direktne linkove u uvodu, dokumentima i hronologiji.
Navodi grupe su označeni odvojeno od zvaničnih izvora.
Domen je povezan sa GitHub Pages i HTTPS je uključen.

ANKETA
Forma pri vrhu pita da li je osoba podnela prijavu Ambasadi u Abu Dabiju
za glasanje u UAE na parlamentarnim izborima u Srbiji 25. oktobra 2026.
Samo posle odgovora Da otvara pitanje o potvrdi Ambasade da je u JBS
upisano interesovanje za glasanje u inostranstvu.
Odgovori se šalju Cloudflare Workeru (folder worker/, uputstvo u
worker/README.txt, adresa https://srbsuae-survey.srbsuae.workers.dev)
koji ih čuva u D1 bazi. Anonimno: čuva se samo odgovor, vreme i HMAC heš
IP adrese. Zaštita: Turnstile, rate limit, globalni limit po satu,
ograničenje odgovora po mreži. Javni brojač se prikazuje tek od 30
odgovora i označen je kao nereprezentativan uzorak.
Worker se postavlja odvojeno od sajta: u folderu worker/ pokreni
npx wrangler deploy (push na main ne menja Worker).
