# Data sources

Checked on 14 November 2026. "Game value" means a plausible number chosen for
the game, not copied from a source. Game values are labelled as such in the game.

## Real data bundled in the game

| Data | Value used | Source |
| --- | --- | --- |
| Earth's orbit | Keplerian elements and rates, Earth-Moon barycentre, Table 1 (1800 to 2050) | [JPL, Approximate Positions of the Planets](https://ssd.jpl.nasa.gov/planets/approx_pos.html) |
| Apophis's orbit | a 0.9224 au, e 0.1911, i 3.341°, node 203.9°, perihelion argument 126.7°, mean anomaly 90.28° at JD 2460800.5 | JPL Small-Body Database orbit as listed on [Wikipedia](https://en.wikipedia.org/wiki/99942_Apophis). Used unmodified. |
| Apophis flyby | 13 April 2029, about 32,000 km above Earth's surface | [NASA, Apophis facts](https://science.nasa.gov/solar-system/asteroids/apophis-facts) |
| Falcon 9 | 8,300 kg to GTO and 4,020 kg to Mars (expended), 5,500 kg to GTO (booster recovered), $69.75M standard price | [SpaceX Capabilities and Services](https://spacex.com/media/Capabilities&Services.pdf), [Falcon 9](https://en.wikipedia.org/wiki/Falcon_9) |
| Falcon Heavy | 26,700 kg to GTO, 16,800 kg to Mars | [SpaceX Falcon Heavy](https://spacex.com/vehicles/falcon-heavy) |
| Solar panels | 8.5 m² give 1,226 to 3,000 W on OSIRIS-REx, about 270 W/m² at 1 au | [NASA OSIRIS-REx fact sheet](https://www.nasa.gov/wp-content/uploads/2016/06/osiris_rex_factsheet5-25.pdf) |
| Visible-infrared spectrometer | 17.8 kg, 8.8 W average (OVIRS) | [Reuter et al., Space Science Reviews](https://link.springer.com/10.1007/s11214-018-0482-9) |
| ESA Ramses (reference mission) | Launch 24 April to 11 May 2028, 10-month transfer, under 1.6 km/s, arrival February 2029, about 1.3 t, 20 km to 1 km standoff, 5 km at flyby | [University of Bern, Ramses overview](https://chances.unibe.ch/instrument__mission/mission_overview/index_eng.html), [JAXA](https://pd.jaxa.jp/articles/en/pd_and_ramses_en.html) |
| Risk classes A to D | Class meanings and example missions | [NASA risk classification fact sheet](https://www.nasa.gov/wp-content/uploads/2023/12/risk-classification-fact-sheet.pdf) |
| 70% confidence rule | Projects above $250M budget at the 70% joint confidence level | [Prince and Smart, NASA NTRS](https://ntrs.nasa.gov/api/citations/20180005523/downloads/20180005523.pdf) |

## Models

| Model | Method | Check (see `tests/`) |
| --- | --- | --- |
| Positions | Two-body Kepler propagation of the elements above | Apophis passes Earth within 6 hours of NASA's published time after 4 years of propagation |
| Launch windows | Universal-variable Lambert solver | Reproduces Vallado's textbook example to 4 decimals; finds the Ramses trajectory (1.42 km/s arrival speed, ESA quotes under 1.6 km/s) |
| Rocket capacity | m(C3) = m0·exp(−C3/k), fitted to the published GTO and Mars payloads | Reproduces published low-Earth-orbit payloads within 15% |
| Propellant | Rocket equation with tank mass and a 15% growth allowance, solved in closed form | Adding 21 kg of instrument adds more than 31 kg at launch |
| Solar power | 270 W/m² at 1 au, inverse square, 8% losses | Within 15% of OSIRIS-REx at 0.9 and 1.36 au |
| Data rate | Link budget to a 34 m Deep Space Network dish at X-band | In family with Mars Reconnaissance Orbiter (0.5 to 4 Mbps) |
| Lunar orbit (for the second scenario) | Patched conics | 50 km orbit: 113 min period, 48 min maximum eclipse, as for Lunar Reconnaissance Orbiter |

## Known simplifications

- The Apophis orbit is rounded and propagated without planetary pulls. The
  model's closest approach is about 3 hours from NASA's time and farther from
  Earth than the real 38,000 km (from Earth's centre). The game shows NASA's date.
- After 13 April 2029 Apophis moves to a new orbit. The game does not offer
  arrivals after the flyby.
- Trajectories are direct, single-arc transfers with no deep-space manoeuvres.

## Game values

Mission class cost caps and build times; hardware costs; test costs and
durations; failure probabilities; the small launcher and shared ride;
Falcon 9 expended and Falcon Heavy prices; Deep Space Network hourly cost and
figure of merit (approximate); masses and powers of instruments other than
the spectrometer (modelled on OSIRIS-REx, Hera and Ramses instruments);
science weights and scoring.
