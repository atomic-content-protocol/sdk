# Live Daytona run

Status: completed.

Mode: volume-parallel.

Fork fallback reason: No runners are configured in region 'eu' for sandbox class 'linux-vm'. Try a different region or sandbox class.

The ACP arm is summary-first. Retrieval hit means the gold page was a summary candidate. The default comparison arm is search-then-read. Naive full-read is an upper bound and is sent only when ACP_LIVE_BASELINE is naive or both.
Token columns are the provider's reported usage. A null means that call did not return usage. Nothing here is estimated.

| N | Complete | ACP input | ACP output | Search input | Search output | Naive input | Naive output | ACP hit | Search hit | ACP answer | Search answer | Sum fork ms | Sum agent ms |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | yes | 333 | 64 | 36,939 | 146 |  |  | 100.0% | 100.0% | 100.0% | 100.0% | 1279 | 62054 |
| 10 | yes | 3,059 | 603 | 330,354 | 889 |  |  | 100.0% | 100.0% | 100.0% | 100.0% | 13579 | 583084 |
| 20 | yes | 6,357 | 1,266 | 783,559 | 1,788 |  |  | 100.0% | 100.0% | 100.0% | 100.0% | 28978 | 1182346 |

## Per question

| Question | Sandbox | ACP candidates | ACP bodies | Search opened | ACP hit | Search hit | ACP in/out | Search in/out | Naive in/out | ACP error | Search error | Naive error |
|---|---|---|---|---|---|---|---:|---:|---:|---|---|---|
| q01 | a6ba20b9-80b6-4e35-84a8-bfe584d67ef5 | alan-turing, printing-press, ada-lovelace |  | alan-turing, public-key-cryptography, rsa | yes | yes | 333/64 | 36939/146 |  |  |  |  |
| q02 | 0f2e40a6-d061-4ddf-8e2b-698362af6fbd | ada-lovelace, voyager-1, tcp |  | ada-lovelace, alan-turing, turing-machine | yes | yes | 336/52 | 39373/98 |  |  |  |  |
| q03 | ed9cdf3c-7832-4b6b-8ae5-09f01c8e18d2 | grace-hopper, tim-berners-lee, quicksort |  | grace-hopper, apollo-11, antikythera | yes | yes | 278/73 | 42727/79 |  |  |  |  |
| q04 | a62a170e-ded4-4a32-9cdf-e63f7d8290a7 | margaret-hamilton, apollo-11, go-game |  | margaret-hamilton, apollo-11, james-webb | yes | yes | 334/75 | 41732/66 |  |  |  |  |
| q05 | 3a3e256c-e45f-404b-b59b-d6faa628f000 | tim-berners-lee, rsa, sahara |  | tim-berners-lee, postgresql, antikythera | yes | yes | 334/84 | 29442/87 |  |  |  |  |
| q06 | 7c3479c0-34af-40b8-acf6-b7c0b78b5043 | linus-torvalds, tcp, chess |  | linus-torvalds, rust, kubernetes | yes | yes | 302/36 | 21057/91 |  |  |  |  |
| q07 | b0e95309-5554-43e4-8845-b07dba46403e | python, rust, library-of-alexandria |  | python, rust, grace-hopper | yes | yes | 262/62 | 26969/121 |  |  |  |  |
| q08 | f8dcc387-484d-4862-92a6-ea82934e3e53 | rust, python, haiku |  | rust, python, postgresql | yes | yes | 303/61 | 28918/72 |  |  |  |  |
| q09 | 46e1b22c-545e-4b14-8b69-2ce011cd3816 | postgresql, rsa, olympic-games |  | postgresql, hubble, python | yes | yes | 324/70 | 41185/74 |  |  |  |  |
| q10 | 76b2f4bc-7495-4be3-b45b-a850e0d8daa7 | kubernetes, turing-machine, quicksort |  | kubernetes, postgresql, linus-torvalds | yes | yes | 253/26 | 22012/55 |  |  |  |  |
| q11 | 716e0268-8d41-4a67-a35c-85788c33b065 | tcp, kyoto-protocol, periodic-table |  | tcp, rust, public-key-cryptography | yes | yes | 356/76 | 32554/94 |  |  |  |  |
| q12 | d8e4c1fa-fc22-44ab-a132-0a459a18e2da | quicksort, tim-berners-lee, alan-turing |  | quicksort, alan-turing, pi | yes | yes | 330/61 | 60086/72 |  |  |  |  |
| q13 | cdb2d2dc-2f03-4645-ac04-1721a6c7b1b5 | turing-machine, periodic-table, pi |  | turing-machine, ada-lovelace, go-game | yes | yes | 283/48 | 39441/84 |  |  |  |  |
| q14 | 53322d92-37b5-41aa-adf2-9cd79179c9d2 | public-key-cryptography, rsa, postgresql |  | public-key-cryptography, rsa, tcp | yes | yes | 322/74 | 38303/80 |  |  |  |  |
| q15 | ddc363be-ec83-429f-bb96-f27d2ced299f | rsa, public-key-cryptography, sourdough |  | rsa, public-key-cryptography, quicksort | yes | yes | 296/48 | 38537/161 |  |  |  |  |
| q16 | 03f888aa-6354-4c4e-8b8c-7c330ddd3321 | voyager-1, hubble, perseverance |  | voyager-1, hubble, james-webb | yes | yes | 355/83 | 46683/89 |  |  |  |  |
| q17 | b6d332d6-fc37-4b93-b43c-0f02ef8c0b81 | apollo-11, perseverance, voyager-1 |  | apollo-11, perseverance, margaret-hamilton | yes | yes | 362/73 | 33416/76 |  |  |  |  |
| q18 | 2a3f8aa8-4689-4102-beab-89a0c73f50ad | hubble, james-webb, voyager-1 |  | hubble, james-webb, apollo-11 | yes | yes | 317/67 | 57500/79 |  |  |  |  |
| q19 | 69d8b8d3-74b6-460b-a0b4-be26ed149c1e | james-webb, hubble, voyager-1 |  | james-webb, hubble, apollo-11 | yes | yes | 314/52 | 57497/67 |  |  |  |  |
| q20 | cbaa50ab-5161-48e0-8b39-551d149238e4 | perseverance, apollo-11, voyager-1 |  | perseverance, apollo-11, hubble | yes | yes | 363/81 | 49188/97 |  |  |  |  |
