ANKETA API (Cloudflare Worker + D1)

JEDNOKRATNO PODEŠAVANJE (iz foldera worker/)
1. npx wrangler d1 create srbsuae-survey
   Upiši dobijeni database_id u wrangler.toml.
2. npx wrangler d1 execute srbsuae-survey --remote --file=schema.sql
3. Cloudflare dashboard > Turnstile > dodaj sajt srbsuae.com.
   Site key ide u index.html (data-sitekey); secret ide u Worker:
   npx wrangler secret put TURNSTILE_SECRET
   npx wrangler secret put VOTER_SALT   (bilo koji dug nasumičan string)
4. npx wrangler deploy
   URL Workera upiši u index.html (data-api).

LOKALNO: napravi .dev.vars sa TURNSTILE_SECRET i VOTER_SALT (u .gitignore).
Za test Turnstile koristi test ključeve: site 1x00000000000000000000AA,
secret 1x0000000000000000000000000000000AA.

ČIŠĆENJE NAKON NAPADA
npx wrangler d1 execute srbsuae-survey --remote --command \
 "UPDATE votes SET hidden=1 WHERE ts BETWEEN <od_ms> AND <do_ms>"

ZAŠTITA: veličina/tip tela, rate limit po IP-u (5/min), stroga validacija,
Turnstile, globalni limit po satu (HOURLY_CAP), do MAX_PER_VOTER odgovora po
HMAC hešu IP-a. Rezultati se objavljuju tek od MIN_PUBLIC odgovora.
