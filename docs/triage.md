# Decktet Game Triage

Research notes for deciding which Decktet games to implement in the web app. Compiled 2026-10-31 from the [Decktet wiki](https://wiki.decktet.com) (each game's info box for Players / Extra Material / Length, plus its rules page). Wiki content is licensed CC BY-NC-SA 3.0. "App fit" assumes extra material is emulated in-app (dice → roll button, chips → on-screen tokens, score sheets → on-screen tables). Deck sizes: basic = 36 cards, extended = 45 cards (basic + Pawns + Courts + Excuse).

## Games

| Game | Wiki page | Players | Extra material | Deck | Length | Core mechanism (≤12 words) | App fit | Wave |
|---|---|---|---|---|---|---|---|---|
| Advent of the Wyrms | [/game:advent-of-the-wyrms](https://wiki.decktet.com/game:advent-of-the-wyrms) | 1 | none | extended (45) | 5–10 min | Set collection: build 4 ascending suit "incantations" | easy | 2 |
| Aucteraden | [/game:aucteraden](https://wiki.decktet.com/game:aucteraden) | 1 | suit chips, pen & paper | basic (36) | 15–30 min | Market buy + 4×4 tableau network/chain building | medium | 3 |
| Cascades | [/game:cascades](https://wiki.decktet.com/game:cascades) | 1 | none | basic (36); pawns/courts optional, no Excuse | ? | Solitaire: play cards into three ranked tiers | medium | 2 |
| Defend and Capture | [/game:defend-and-capture](https://wiki.decktet.com/game:defend-and-capture) | 1 | none | extended minus Excuse (44) | 20 min | Lane defense on 3×3 grid; capture vs. damage | medium | 3 |
| Dueling Runes | [/game:dueling-runes](https://wiki.decktet.com/game:dueling-runes) | 2 (works 1–4) | markers, a die per player | extended minus Excuse (44) | 20m | Simultaneous spell casting from rune sequences | medium | 4 |
| Head Solitaire | [/game:head-solitaire](https://wiki.decktet.com/game:head-solitaire) | 1 | none | basic (36) | Short | Hand management: meld suit/kind/run sets | easy | 1 |
| Hexaract | [/game:hexaract](https://wiki.decktet.com/game:hexaract) | 1 | 5 six-sided dice, suit chips, damage tracker | basic (36) | 10–15 min | Dice-couplet assignment; gather resources, avoid harm | medium | 3 |
| Hidden Wall | [/game:hidden-wall](https://wiki.decktet.com/game:hidden-wall) | 1 | 2 dice, suit chips | extended (45) | ? | Dice-draft cards/tokens; cover locations with values | skip | 4 |
| Ivory Tower | [/game:ivory-tower](https://wiki.decktet.com/game:ivory-tower) | 1 | none | basic (36) | ? | Build one-suit ascending tower via reserve piles | easy | 1 |
| Kittyhawk | [/game:kittyhawk](https://wiki.decktet.com/game:kittyhawk) | 1 | double decktet | two decktetts (60-card Myrmex deck) | (blank) | Freecell-style solitaire: foundations, tableau, heaps | medium | 3 |
| Myrmex | [/game:myrmex](https://wiki.decktet.com/game:myrmex) | 1 | (none listed) | two decktetts (60-card Myrmex deck) | 20 mins | Spider solitaire: descending suit sequences, 6 chambers | medium | 3 |
| Quetinny | [/game:quetinny](https://wiki.decktet.com/game:quetinny) | 1 | 6 suit chips, 6 markers, paper/pencil | basic (36) | 30–60 min | Trade-route network, spice pickup/delivery, taxes | hard | 4 |
| Quincunx | [/game:quincunx](https://wiki.decktet.com/game:quincunx) | 2–4 (+solitaire) | none | basic (36) | ? | 5×5 grid placement with pair/straight scoring | easy | 2 |
| Reino de Ámbar | [/es-game:reino-de-ambar](https://wiki.decktet.com/es-game:reino-de-ambar) | 1–3 | 1d6, ~42 influence markers, gold tokens, confident | Decktet + 1st expansion + 2 extra Aces | 30–45 min | Area influence + problem resolution vs. barbarians | hard | 4 |
| Soliterrapin | [/game:soliterrapin](https://wiki.decktet.com/game:soliterrapin) | 1 | none | basic (36) | ? | Free tableau placement scored with Terrapin rules | easy | 1 |
| Solo Hex | [/game:solo-hex](https://wiki.decktet.com/game:solo-hex) | 1 | none ("extended Decktet" = deck) | extended (45) | Short | Merge hexagonally adjacent piles sharing a suit | medium | 3 |
| Three Towers | [/game:three-towers](https://wiki.decktet.com/game:three-towers) | 1 | none | ranks 2–9 only (24 cards) | 20 min | Towers-of-Hanoi-style descending suit-matching stacks | easy | 1 |
| Tinker Sailor Soldier Spy | [/game:tinker-sailor-soldier-spy](https://wiki.decktet.com/game:tinker-sailor-soldier-spy) | 1 | extended decktet + 36 suit chips | extended (45) | 20 min | Friday-like: spend chips to beat challenges, weariness | medium | 3 |
| Window | [/game:window](https://wiki.decktet.com/game:window) | 1 | none | basic (36) | ? | Merge 3×3 grid stacks onto rank ±1 neighbours | easy | 1 |
| Wyvern Pass Not | [/game:wyvern-pass-not](https://wiki.decktet.com/game:wyvern-pass-not) | 1 | none | extended, Excuse = mage; Aces set aside in advanced | 1 or several rounds of 2–5 m each | Build an 8-card ring where every link shares suits | medium | 2 |
| Ace Trump | [/game:ace-trump](https://wiki.decktet.com/game:ace-trump) | 2–6 | none | basic (36); Excuse/Pawns optional | ? | Trick-taking; aces set trump when played | easy | 1 |
| Ascend | [/game:ascend](https://wiki.decktet.com/game:ascend) | 3–4 | none | extended (45; basic playable) | – | Climbing game: sets, straight flushes, bombs | not-at-2p | 3 |
| Bharg | [/game:bharg](https://wiki.decktet.com/game:bharg) | 2 | none | basic (36) | 15 min | Set collection: bind all 7 cards via suit-completing sets | easy | 1 |
| Bisque | [/game:bisque](https://wiki.decktet.com/game:bisque) | 3 | none | basic (36) | ? | Trick-taking with secret goal suits; winner picks pot card | not-at-2p | 3 |
| Caravan | [/game:caravan](https://wiki.decktet.com/game:caravan) | 2 | none | basic (36) | 30 min | Ladder climbing: caravans vs. ace/crown bandits | easy | 2 |
| Chancellors | [/game:chancellors](https://wiki.decktet.com/game:chancellors) | 2–4 | dice, scorepad | basic (36) | 30 min | Control services, solve escalating dice problems | medium | 3 |
| Chicane | [/game:chicane](https://wiki.decktet.com/game:chicane) | 3–4 | none | basic (36) | (not stated) | Bid tricks; each card read as top- or bottom-suit only | not-at-2p | 3 |
| Colour Bazaar | [/game:colour-bazaar](https://wiki.decktet.com/game:colour-bazaar) | 2–3 | 30 suit chips (5 per suit) | basic (36); Courts optional | 30 min | Commodity speculation: influence stacks, buy chips | medium | 3 |
| Corundum Conundrum | [/game:corundum-conundrum](https://wiki.decktet.com/game:corundum-conundrum) | 4 | none | (not stated on wiki) | 1 hour? | Partnership trick-taking with Terrapin-style scoring | not-at-2p | 4 |
| Double Knot | [/game:double-knot](https://wiki.decktet.com/game:double-knot) | 3–5 | none | extended (45; basic playable) | ? | Bid exact tricks; each card has one suit, lead sets trumps | not-at-2p | 3 |
| Emu Ranchers | [/game:emu-ranchers](https://wiki.decktet.com/game:emu-ranchers) | 2 | none | basic (36) | 25 minutes | Grow suit stacks (birds); pay upkeep, bank profit | easy | 1 |
| Fifes and Drums | [/game:fifes-and-drums](https://wiki.decktet.com/game:fifes-and-drums) | 2 | six tokens, battlefield track | extended (45) | 15 minutes | Hidden-goal tug-of-war: retreat units along a track | medium | 3 |
| Goblin Market | [/game:goblin-market](https://wiki.decktet.com/game:goblin-market) | 3–6 | coins | basic as auction deck + pawns/courts as goblin deck (Excuse unused) | 30 min | Open auctions; own-matched ranks pay you coins | not-at-2p | 3 |
| Hermit | [/game:hermit](https://wiki.decktet.com/game:hermit) | 2–5 | none | basic (36) | 30 min | Avoid winning tricks containing personality cards | medium | 3 |
| Kingpins | [/game:kingpins](https://wiki.decktet.com/game:kingpins) | 3–5 | tokens | (not stated on wiki) | 1 hour | Auction + simultaneous action (rules book-only) | not-at-2p | 4 |
| Magnate | [/game:magnate](https://wiki.decktet.com/game:magnate) | 2 | dice and tokens | extended (45; Courts optional) | 30 minutes | District city building; dice income, deeds, taxation | medium | 4 |
| Nonesuch | [/game:nonesuch](https://wiki.decktet.com/game:nonesuch) | 3–4 | none | basic + Excuse (37) | 30 min? | Bid Some/Most/None; leader names follow-suit per trick | not-at-2p | 3 |
| Oh Quay | [/game:oh-quay](https://wiki.decktet.com/game:oh-quay) | 2 | none | basic (36) | 15 minutes | Insert cargo into canal; launch ordered same-suit rafts | easy | 1 |
| Otgovorko | [/game:otgovorko](https://wiki.decktet.com/game:otgovorko) | 3–4 | "anger" (none) | (not stated on wiki) | 20 minutes | Attack the player left; shed hand after deck empties | not-at-2p | 4 |
| Second Story | [/game:second-story](https://wiki.decktet.com/game:second-story) | 2–5 | dice, chips | basic (36) | 15 minutes | Press-your-luck burglary with d10 risk, chips bank | easy | 2 |
| Shed | [/game:shed](https://wiki.decktet.com/game:shed) | 2–5 | 1 token of each suit per player (30 tokens) | basic (36); pawns/courts optional | 10 min/player | Trick-taking by card type; winners shed suit tokens | medium | 3 |
| Terrapin | [/game:terrapin](https://wiki.decktet.com/game:terrapin) | 2–7 | coins/chips | basic (36) | open ended | Betting on pairs/straights; avoid Turtle Butt (4 variants) | medium | 4 |
| Thricewise | [/game:thricewise](https://wiki.decktet.com/game:thricewise) | 2–5 | a scorepad | basic (36) | 20 minutes | Simultaneous card choice into 6×6 grid; three-in-a-row | easy | 2 |
| Varg Bid | [/game:varg-bid](https://wiki.decktet.com/game:varg-bid) | 3–5 | none | basic (36) + Excuse as auction token | ? | Auction: hand is both goods and bidding currency | not-at-2p | 3 |
| Frogger / Xing | [/game:frogger](https://wiki.decktet.com/game:frogger) | 2–5 | 30 frogs (6 tokens in 5 colors) | extended (45; Excuse + pawns on corridor) | 20–30m | Race 6 tokens along a card corridor by suit matching | medium | 3 |

### Already implemented (player counts for comparison)

| Game | Players | Length | Extra material |
|---|---|---|---|
| Adaman | 1 | 5 minutes | none |
| Jacynth | 1–3 | 20 minutes | 4 markers per player |
| Gongor Whist | 1 | quick | none |

## Notes

- **Hidden Wall** — no playable rules: the win condition is literally "enough resources (yet to be determined)", the Harvest and Rite events are marked "?", and the 2P mode is only "some ideas". Tagged work-in-progress. Do not implement without new rules.
- **Quetinny** — the wiki page is explicitly stale: it says the rules are under development and points to an external Google Doc as the source of truth. Extended-deck options ("any combination of the Courts, Pawns and the Excuse") are left to player taste. Risky to build from the wiki alone.
- **Reino de Ámbar** — rules exist only in Spanish; there is no English page. Deck needs the 1st expansion (Pawns) plus two extra copies of the Aces. The solo dummy player's behaviour includes judgment calls ("sé honesto" / be honest about picking non-absurd options), so the AI would need us to pin down heuristics.
- **Corundum Conundrum, Kingpins, Otgovorko** — wiki pages are stubs: no deck, no rules, only player counts/length; rules live in The Decktet Book (and for Corundum, a BGG thread). Cannot be implemented from wiki content.
- **Cascades** — tagged work-in-progress; Length is "?". The extended-deck paragraph is confusingly worded (second pawn/court on the top tier "can only be played when the corresponding card has been played on the bottom tier" — presumably means a lower tier), so pawn/court handling needs a decision.
- **Dueling Runes** — internally inconsistent: the intro says the spell sequence is limited to 4 cards, but the end-of-turn rule says trim it to 3. The advanced spell table is "not yet done". The official solo variant requires the player to choose the opponent's spells "fairly", i.e. it needs an authored AI policy, not just rules.
- **Window** — the wrap rule "Aces may move onto either 1s or Crowns. Crowns may move onto either 9s or Aces" is garbled ("1s" is presumably Aces); it most likely means Ace↔Crown adjacency is allowed, but confirm before coding.
- **Caravan** — mentions that "wild cards" can substitute for a number rank, but never says which cards are wilds (presumably extended-deck additions). Basic-game rules are otherwise complete.
- **Quincunx** — two conflicting setups: the wiki's default deals 5 starting cards, while the revised Decktet Book made the 1-card "Blank Slate" start the default. Pick one (or expose a toggle) and document it.
- **Shed** — the "Kingmaker Scenario" has two officially sanctioned resolutions (shared victory vs. take-from-supply penalty); the app should choose one or expose it as an option. 2P and partnership rules exist but with modified card counts/ace scoring — implement the 2P variant rules exactly.
- **Terrapin** — four sub-games (Western, Provincial, Temptation, Liar's) sharing one hand-ranking; betting/raise limits are "agreed upon by the group", so the app must set defaults. Provincial and Liar's "play better with 4".
- **Wyvern Pass Not** — explicitly beta. Deck description is garbled ("all the basic Decktet cards plus the Aces, the Crowns and the Pawns" — the basic deck already has aces/crowns); the advanced setup says "all the cards less the Excuse and the Aces", implying Pawns and Courts are both in. Needs a ruling on Courts.
- **Hexaract** — never states which deck to use; setup only separates Aces out, and the extended-deck section is empty ("I haven't come up with any ideas"). Damage tracking method is left to the player. Basic deck (36) is the safe assumption.
- **Kittyhawk** — requires two Decktetts (60-card Myrmex deck); Length field is blank. Difficulty levels 2–5 recommend specific pawn/court mixes as player preference, so defaults must be chosen.
- **Myrmex** — requires two Decktetts (60-card Myrmex deck); levels recommend removing specific duplicate pawns/courts (e.g. both Light Keepers) — same default-picking issue as Kittyhawk.
- **Defend and Capture** — uses a 44-card deck (extended minus Excuse). The wiki page is complete but points to a better-formatted PDF rulebook with an example turn on BGG; a digital version also exists (github.com/gjchangmu/A-Few-Decktet-Games) — useful reference.
- **Aucteraden** — info box lists only "Suit chips" but the rules also require pad and pencil (on-screen score table covers this). Extended-deck rules exist but are optional; base game uses the basic deck.
- **Solo Hex** — the hexagon setup is described only in prose plus a photo; the "flip out" loss condition is loosely phrased. Rules are complete enough but will need careful layout work.
- **Tinker Sailor Soldier Spy** — tagged work-in-progress; several phrases are ambiguous ("add an Ace to your hand"/"to your discard pile" used interchangeably for weariness). Alternative rule write-ups exist (mcdemarco.net, a BGG walkthrough) and should be consulted.
- **Two Decktetts needed:** Kittyhawk, Myrmex. (In-app this is just duplicate card data, but flag it in the UI.) **Large physical board:** none of the candidates need a printed board; the largest grids are 6×6 (Quincunx solitaire 4×4, Thricewise, Soliterrapin, Jacynth-style grids) and the Fifes and Drums track (~45 spaces) — all easy on screen.
- **No wiki page / stub:** none missing entirely, but Corundum Conundrum, Kingpins and Otgovorko are stubs (see above). Length is unstated ("?") for Cascades, Hidden Wall, Ivory Tower, Kittyhawk, Quincunx, Soliterrapin, Window, Ace Trump, Bisque, Chicane, Double Knot, Nonesuch and Varg Bid.
- **Ascend** works only at 3–4 despite being in the book list; its Length field is just "-".

## Suggested order

### (a) Solo games

1. **Ivory Tower** — pure card stacking, no tokens, complete and short rules.
2. **Window** — tiny 3×3 merging puzzle; smallest possible state machine.
3. **Three Towers** — 24-card subset, trivial tower rules, several difficulty knobs for free.
4. **Head Solitaire** — meld-detection logic only; no table layout needed.
5. **Soliterrapin** — free placement plus Terrapin scoring; scoring code reused for later games.
6. **Advent of the Wyrms** — clean set-collection loop; first use of the extended deck.
7. **Wyvern Pass Not** — link-ring puzzle with a small card pool; beta rules are self-contained.
8. **Cascades** — tier-placement engine; WIP tag but internally consistent enough.
9. **Myrmex** — spider-solitaire engine; also builds the 60-card two-Decktet deck data.
10. **Kittyhawk** — reuses the Myrmex deck; adds freecell-style tableau/heaps UI.
11. **Solo Hex** — new hex-pile layout widget; rules need the most interpretation of the "easy" group.
12. **Tinker Sailor Soldier Spy** — chip-resource engine (Friday-like); benefits from chip UI built for wave-3 games.
13. **Aucteraden** — chip economy + 4×4 tableau + market-refill cascade logic.
14. **Defend and Capture** — 3×3 combat grid with five action types; larger state to verify.
15. **Hexaract** — combines dice roller, chips, and a harm track; heaviest widget set.
16. **Quetinny** — defer: rules live off-wiki and are still in flux.
17. **Reino de Ámbar** — Spanish-only rules plus a heuristic dummy player; biggest design risk.
18. **Dueling Runes** — many timed status effects and secret simultaneous choices; heaviest engine.
19. (Hidden Wall) — skip until the designer finishes the rules.

### (b) Two-player book games

1. **Bharg** — pure set collection, 15 minutes, zero extra components.
2. **Emu Ranchers** — same stack-growing feel; free online implementations exist as reference.
3. **Oh Quay** — self-contained canal/raft engine, playable without a table in the original.
4. **Ace Trump** — simplest trick-taker; establishes the shared trick-taking infrastructure.
5. **Caravan** — clean 2P climbing/shedding duel with complete rules.
6. **Thricewise** — grid + pattern scoring; shares scoring code with Quincunx/Soliterrapin.
7. **Second Story** — press-your-luck with dice and chips; exercises the dice/chip widgets cheaply.
8. **Hermit** — builds on trick infrastructure with multiple concurrent tricks and ace-cancels-crown.
9. **Shed** — type-based tricks plus token shedding; official 2P rules included.
10. **Chancellors** — dice-pair problems and service control; noticeably bigger state machine.
11. **Colour Bazaar** — chip speculation with end-game valuation math (app can auto-score).
12. **Fifes and Drums** — track UI plus a hidden goal card; different genre, low rules risk.
13. **Magnate** — the deepest 2P game (districts, deeds, dice economy, taxation); do last.
