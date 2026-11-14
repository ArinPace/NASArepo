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

## Real data for Ice Hunter (the Moon)

| Data | Value used | Source |
| --- | --- | --- |
| Lunar Reconnaissance Orbiter spacecraft | 1,916 kg at launch, 1,018 kg dry, 898 kg of propellant, 685 W | [NASA LRO launch press kit, as reprinted by Spaceflight Now](https://spaceflightnow.com/atlas/av020/090610lro.html) |
| LRO instruments | Neutron detector 25.8 kg and 11.6 W; laser altimeter 11.3 kg and 33.4 W; thermal radiometer 11.0 kg and 24.7 W; imaging radar 13.8 kg and 7.0 W; camera 19.2 kg and 24.0 W; neutron detector resolves 10 km | Same press kit |
| LRO orbit | 50 km polar orbit held with monthly burns; a four to five day minimum-energy transfer; camera detail of 50 cm from 50 km | [Vondrak and others, LRO mission overview, NASA Technical Reports Server](https://ntrs.nasa.gov/api/citations/20140000908/downloads/20140000908.pdf) |
| LRO lap time, speed, data volume | About 113 minutes a lap at 1.6 km/s; 572 Gb of data a day | [eoPortal, Lunar Reconnaissance Orbiter](https://eoportal.org/satellite-missions/lro) |
| LRO propellant budget | 898 kg of fuel for 1,263 m/s | [LRO instrument suite briefing](https://faculty.tamuc.edu/cdavis/resources/Insctructional/LRO%20Instrument%20Suite%20and%20Measurements.pdf) |
| Total lunar eclipses | 31 December 2028, 26 June 2029 and 20 December 2029, each with about three and a half hours in Earth's umbra | [Eclipse predictions by Fred Espenak, NASA GSFC](https://eclipse.gsfc.nasa.gov/LEdecade/LEdecade2021.html) |

## Models

| Model | Method | Check (see `tests/`) |
| --- | --- | --- |
| Positions | Two-body Kepler propagation of the elements above | Apophis passes Earth within 6 hours of NASA's published time after 4 years of propagation |
| Launch windows | Universal-variable Lambert solver | Reproduces Vallado's textbook example to 4 decimals; finds the Ramses trajectory (1.42 km/s arrival speed, ESA quotes under 1.6 km/s) |
| Rocket capacity | m(C3) = m0·exp(−C3/k), fitted to the published GTO and Mars payloads | Reproduces published low-Earth-orbit payloads within 15% |
| Propellant | Rocket equation with tank mass and a 15% growth allowance, solved in closed form | Adding 21 kg of instrument adds more than 31 kg at launch |
| Solar power | 270 W/m² at 1 au, inverse square, 8% losses | Within 15% of OSIRIS-REx at 0.9 and 1.36 au |
| Data rate | Link budget to a 34 m Deep Space Network dish at X-band | In family with Mars Reconnaissance Orbiter (0.5 to 4 Mbps) |
| Lunar orbit (Ice Hunter) | Patched conics: a transfer just short of escape, then a capture burn into a circular polar orbit | 50 km orbit: 113 minute lap, 48 minutes of night, 829 m/s to capture. Capture plus a year of orbit keeping fits inside LRO's 1,263 m/s |
| Battery | Night on each lap, and the hours in Earth's shadow during a total lunar eclipse, against battery capacity | The rocket equation with LRO's published masses gives 1,395 m/s against the published 1,263 m/s |

The start screen of the game has a "How real is this?" panel that reruns the
position, launch window, rocket, solar power and data rate checks, plus an
Earth-orbit check, in the browser.

## Known simplifications

- The Apophis orbit is rounded and propagated without planetary pulls. The
  model's closest approach is about 3 hours from NASA's time and farther from
  Earth than the real 38,000 km (from Earth's centre). The game shows NASA's date.
- After 13 April 2029 Apophis moves to a new orbit. The game does not offer
  arrivals after the flyby.
- Trajectories are direct, single-arc transfers with no deep-space manoeuvres.
- At the Moon, the hours without sunlight in a lunar eclipse are taken as the
  whole time the Moon spends in Earth's umbra. Solar panels are sized for the
  longest night an orbit can have.

## Game values

In Ice Hunter: the landing-site decision date of 1 July 2029, the fuel to
hold a 100 km or 30 km orbit, the compact neutron counter, instrument costs
and data rates, and the chance of a missed correcting burn.

The chances behind the calls made in flight (wind shear at launch, solar
storm damage, debris during the flyby, a missed flyby picture) and the price
of emergency network time; mission class cost caps and build times; hardware costs; test costs and
durations; failure probabilities; the small launcher and shared ride;
Falcon 9 expended and Falcon Heavy prices; Deep Space Network hourly cost and
figure of merit (approximate); masses and powers of instruments other than
the spectrometer (modelled on OSIRIS-REx, Hera and Ramses instruments);
science weights and scoring.
