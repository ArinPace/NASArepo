# GO / NO-GO

A space mission design game built on real NASA and JPL data, made for the
**NASA Space Apps Challenge 2026** (challenge: *Space Mission Design Game*).

Players design a real mission to asteroid **Apophis**, which passes about
32,000 km above Earth on 13 April 2029. They defend the design at four
NASA-style review gates, fly it, and get a debrief that links every outcome
to the decision behind it.

**Play it:** open `docs/index.html` in any browser. It is one self-contained
file and works offline. (If GitHub Pages is enabled for the `docs/` folder,
it is also at `https://arinpace.github.io/NASArepo/`.)

## What makes it different

- **Real launch windows.** The launch chart is computed in the browser by a
  Lambert solver from published orbits of Earth and Apophis. Fed only those
  orbits, it independently finds the trajectory ESA chose for its Ramses
  mission (launch 24 April 2028, arrive about 1 March 2029, 1.4 km/s of braking).
- **The poll.** Every phase ends in a GO / NO-GO vote. One to four players
  share a screen; each owns a console (Mission Design, Spacecraft, Science,
  Comms and Data) and the team must settle every NO-GO.
- **The Snowball.** Add a part and the game shows what it drags along: power,
  panels, structure, propellant, launch mass, cost.
- **A thousand flights.** Before launch the game flies the design 1,000 times
  and reports how often it survives and succeeds, plus the cost that 70% of
  outcomes stay under (NASA's joint confidence level rule).
- **Causes, not dice.** Each flight is one seeded world. Fly the same world
  again with one change and see exactly what that change bought.
- **Three depths.** Cadet (plain words), Engineer (numbers), Chief engineer
  (the equations).

## The six resources

Mass, power, data, budget, time and delta-v stay on screen as live meters.
In this scenario **time** is the critical one: Apophis will not wait.

## Run and test

```
npm install
npm run build      # writes docs/index.html
npm test           # 12 tests against published values
npm run dev        # rebuilds on change, serves http://localhost:8000
```

## How it is built

| Path | What it holds |
| --- | --- |
| `src/sim/astro.ts` | Kepler propagation, Lambert solver, patched conics |
| `src/sim/data.ts` | Bundled data, each entry with its source |
| `src/sim/design.ts` | Budgets (mass, power, data, cost, time, delta-v) and review findings |
| `src/sim/flight.ts` | Seeded flight simulation, 1,000 flights, scoring |
| `src/ui/` | React screens, charts and the poll |
| `tests/` | Checks against Vallado's Lambert example, NASA's Apophis flyby time, ESA's Ramses trajectory, LRO, OSIRIS-REx, SpaceX figures |

No server, no accounts, no network calls at run time. A saved mission is a
short code holding the design and the world number.

## Data and honesty

See [DATA_SOURCES.md](DATA_SOURCES.md). Numbers copied from a public source
carry a link in the game. Numbers chosen for the game are labelled
"game value". See [AI_USE.md](AI_USE.md) for how AI tools were used.

Not affiliated with or endorsed by NASA, ESA or JAXA.

## Licence

Apache-2.0.
