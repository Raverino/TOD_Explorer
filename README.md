# TOD Explorer

Turn any place into a colourful cube city and test Transit-Oriented Development (TOD) strategies on it.

TOD Explorer is a free, non-commercial web game based on the master's thesis
*Modeling Transit-Oriented Development: A Land-Use Approach for Urban Decarbonization*
(Dimas, 2025, University of Twente, [doi:10.5281/zenodo.16635783](https://doi.org/10.5281/zenodo.16635783)).
It reuses the thesis method (the 10 land-use classes, the scenario and growth algorithms, and the
transit, housing and carbon indicators) and checks the result against the
[ITDP TOD Standard (2017)](https://www.itdp.org/library/standards-and-guides/tod3-0/), using free
data that works for any city.

## How it works

The game is guided: after the place is picked, each step sits in one panel beside the 3D city, with
the live results on the city and the TOD score under the panel, so nothing needs scrolling.

1. **Pick a place.** Search a city and frame a square of 1–20 km. **Build cube city:** the browser downloads free OpenStreetMap vector tiles, elevation tiles
   and a measured population grid, then sorts every cell of a grid (up to 200 × 200) into the thesis classes:

   | Class | Name | Estimated from |
   |---|---|---|
   | 1 | High-density urban fabric | building footprint coverage ≥ 27.5 % in a ~125 m neighbourhood |
   | 2 | Medium-density urban fabric | neighbourhood coverage ≥ 12.5 % |
   | 3 | Low-density urban fabric | neighbourhood coverage ≥ 8.5 % |
   | 4 | Commercial and industrial | commercial, retail, industrial and institutional land use |
   | 5 | Transportation infrastructure | major roads, rail, railway land |
   | 6 | Development opportunity zones | construction and brownfield land |
   | 7 | Urban green and recreation | parks, woods, gardens, pitches, cemeteries |
   | 8 | Agricultural and rural | farmland, meadows, other open land |
   | 9 | Water and wetlands | water, rivers, wetlands |
   | 10 | Excluded and special zones | airports, military, quarries, landfills |

   The coverage thresholds were calibrated so that class 1–3 areas match Copernicus Urban Atlas 2018.

   - **Floor area** is each building's footprint × floors (OpenStreetMap height ÷ 3 m).
   - **Residents are measured**, not estimated: the EU Census 2021 1 km grid, placed inside each
     square kilometre with the JRC GHS-POP 2020 grid (about 90 m, read from a cloud-optimised
     GeoTIFF), then spread onto homes in proportion to their floor area.
   - **Walking distances** to transit are computed along
     streets and paths, with water, motorways and railway tracks as barriers.
2. **Growth and land.** First, how many people live here by 2050: by default the country's change
   in Eurostat's EUROPOP2023 baseline projection, 2025 → 2050 (`proj_23np`; EU figure for countries
   outside it), or no change, fast growth (+25 %) or any value from −25 % to +40 %. Then how much new
   urban land the city may open at its edge by 2050: none, a little (+5 % of today's urban land,
   about the thesis regular demand) or plenty (+30 %, about its high demand), or any value up to 40 %.
3. **Choose a policy, watch it grow.** Each year 1/25 of the newcomers need homes, and the policy
   decides where they go:
   - **TOD policies** (Intense Building, Retrofitting, Balanced, Custom; thesis Table 5, scripts
     04–06) first build up within the TOD distance of a stop, outside protected areas. Each rule
     runs at an even pace and reaches its share in 2050; with decay on, cells nearer transit go first
     (exp(−0.005·d)), and changes grow as patches (thesis CLUSTER_THRESHOLD, 70 %). Conversions
     that add homes happen only when homes are needed; parks, green streets, shops and retrofits
     follow the pace whatever the demand. Only when that is not enough do they open new land.
   - **Baseline** builds only on new land.
   - **New land** comes from a browser port of the SIMLANDER typical model (TM_S) used in the thesis:
     potential = neighbourhood + Weibull randomness + accessibility (White's 1/(1+d)) + slope
     suitability, each scaled 0–1, allocated year by year up to the allowance. Baseline follows roads
     and may use parks and protected areas; TOD weights accessibility 20 % roads / 80 % transit and
     keeps them free. Cells where people already live are not open land. New cells get a class from
     the thesis traceback rules, with thresholds from the chosen city's own statistics (75th
     percentiles, as in scripts 02–03).
   - A converted or new cell takes the typical floor area of its class in that city, and its residents
     follow the city's measured residents per m² of housing, so residents in the scoreboard are
     today's plus the newcomers housed. Newcomers left over have no home here: the game says how many
     and why (rules used up, land allowance used up, or no free land left).

   This is speculation, not a forecast.
4. **New transit (optional).** Add rail or metro stations by clicking on the city (the cursor
   becomes a pin), or let the game place 1–5 of them. They appear as red map pins in cubes, each
   labelled with the people within a 1 km walk. TOD strategies build around them and TOD growth
   moves towards them ("transit first, homes after", Hong Kong). Each new station has its own
   station area: the TOD Standard check scores the main station and every new one and shows the
   best, so a town with no station (score 0) gets a score once one is built. If nobody new moves
   in, or Baseline is picked, the step offers a button back to step 2 or 3.

   Controls: drag to turn the city, double-click and drag (or right-drag) to move it, Ctrl + scroll
   or the buttons to zoom. On touch screens, one finger turns and two fingers move and zoom.
5. **Results.** A report with what the numbers mean, questions to explore, all the details (TOD
   Standard table, indicators, sources), a PDF, and a share image at the end.

## Results

Three headlines:

- **Urban CO₂ per resident**
- **Residents meeting the TOD transit standard**
- **Housing capacity**

Below them is the **TOD Standard check** and every indicator with its locked reference value.

| Measure | Method |
|---|---|
| Urban CO₂, anchored | Where the place is in the Moran et al. (2022) inventory (2018, 108,000 European municipalities, matched by name through OpenStreetMap), today starts from its buildings + road fuel per resident. Each strategy then moves that figure by the relative change of the model below (CO₂ of homes, shops, green and car travel per resident). Elsewhere the model figure is shown as it is |
| Urban CO₂, model | Land area × yearly emissions per m² of land by land-use type: 24.84 / 27.31 / 29.80 kg for high-rise / low- and mid-rise / terraced housing, 45.31 kg retail. Block-level totals from Eindhoven (building energy, residents' travel and daily life, vegetation): Wang, Han & de Vries (2019), Table 5, cited as Yang et al. (2019) in Dimas (2025) |
| Green uptake | Urban green −1.03 kg CO₂/m²/yr (urban tree canopy, Nowak et al., 2013, upper estimate); extensive green roofs −0.69 kg CO₂/m²/yr (0.375 kg C/m² over two years, Getter et al., 2009, in Whittinghill et al., 2014) on the 20 % of buildings that can take one (Joshi et al., 2020) |
| Car travel CO₂ | Every resident × 3.2 kg travel CO₂ per person per day × 70 % from cars (Brand et al., 2021) × 365, adjusted for home density within ~500 m (5.5 % more car fuel per 3.86 fewer homes per hectare, Brownstone & Golob, 2009; 2.3 people per home, Eurostat, 2023) and 39 % lower for residents who meet the TOD transit standard (Park et al., 2018) |
| Retrofit | Strategies can retrofit a share of homes near transit (Retrofitting 30 %, Balanced 15 %, an app setting adjustable in Custom). A retrofit cuts the building part of emissions (49 % of city emissions, Croci et al., 2021) by 30 % (Shu et al., 2024); the range's low end uses 18 % (Pasichnyi et al., 2019) |
| TOD transit (4.A.1) | Walk ≤ 1000 m to rail, metro or BRT (bus stop on a busway), or ≤ 500 m to a bus, tram or ferry stop with rapid transit within 5 km. Ferries count as direct services because open data cannot tell a frequent ferry from a tourist boat. Frequency is not in open data, so this is an upper bound |
| TOD Standard check | Every TOD Standard metric that free, Europe-wide open data measures with confidence; the rest are left out rather than guessed. Scored: Connect 3.A.1 small blocks (10), Transit 4.A.1 walking distance (required, not scored), Mix 5.A.2 local services (3) and 5.A.3 parks and playgrounds (1), Densify 6.A.1 and 6.A.2 (15), Compact 7.A.1 urban site and 7.B.1 transit options (10), Shift 8.A.3 roadway area (6): 45 of the Standard's 100 points. One station area is scored: the rail or metro station nearest the centre of the frame, within a 1000 m walk |
| Left out | Walk 1.A.1–1.B.1 (sidewalks, crossings, active frontages, permeability, shade) and Cycle 2.A.1–2.B.3 (cycle network, bike parking): mapped too unevenly across Europe. Connect 3.B.1 (walking vs driving intersections): depends on whether sidewalks are mapped as separate paths. Mix 5.A.1 (balance of residential and other floor area): floor area by use is not in open data everywhere. Mix 5.B.1–5.B.3 (affordable housing, keeping residents and shops): no Europe-wide data. Shift 8.A.1 (off-street parking) and 8.A.2 (driveways): underground parking and driveways are not mapped reliably. Service frequency (every 15 minutes) is not in uniform Europe-wide data, so 4.A.1 and 7.B.1 are best cases |
| Small blocks (3.A.1) | Streets, service roads open to the public, footways, paths and steps (not motorways, parking aisles or driveways) joined into a walking network where they meet or cross; dead ends pruned; each block side measured corner to corner, sides under 25 m (crossings, slip lanes) left out. The length 90 % of sides within the 1000 m walk stay under: < 110 m 10 points, < 130 m 8, < 150 m 6, < 170 m 4, < 190 m 2 |
| Local services (5.A.2) | For fresh food (supermarket, greengrocer, butcher, market, deli or corner shop) within a 500 m walk, a school within 1000 m, and a doctor, clinic, hospital or pharmacy within 1000 m (OpenStreetMap): 1 point each when at least 80 % of built cells in the station area reach it |
| Parks and playgrounds (5.A.3) | Public parks, village greens, recreation grounds and playgrounds of at least 300 m² (not private gardens), plus new green from a strategy, within a 500 m walk of at least 80 % of built cells: 1 point |
| Densify, simplified | The Standard compares the station area with the densest district of the city of similar desirability, judged by property values, in floor area of homes and of other uses. Property values, floor area and jobs are not in open data everywhere, so two simpler checks replace it. **People living near the station (6.A.2, 8 points):** residents per hectare of urban land (water and farmland left out) within a 1000 m walk, from the EU census grid, against UN-Habitat's (2014) target of 150; points in step with density. **Shops and services by the station (6.A.1, 7 points):** share of cubes with commercial land or a mapped shop, café, office or public service (OpenStreetMap); 4 points when the 1000 m walk has more than the built-up city today, 3 more when the 500 m right by the station has more still |
| Population to 2050 | Eurostat EUROPOP2023 baseline projection by country (`proj_23np`, population on 1 January, 2025 and 2050), applied to the area's measured residents. National only: cities often grow faster than their country, so the player can change it |
| New transit | Players add rail or metro stations by clicking on the city, or let the game suggest them: greedy cover of the most new urban land Baseline uses by 2050 (or, without new land, of residents beyond a 1000 m walk of rail) within 1000 m, on land next to a street. New stations change walking access, TOD policies and TOD growth, and each is scored as a station area of its own (the best one is shown); Baseline growth and the comparisons keep today's network. After Hong Kong's Rail plus Property model (Cervero & Murakami, 2009) |
| Housing capacity | Today's living space from Eurostat (dwelling size ÷ household size by country and degree of urbanisation, 2012) × today's residents; new or removed home floor area counts at 60 % as living space (the median of 15 places checked against Eurostat, interquartile range 45–75 %); ÷ 40 m² per person |

Each headline also shows a **likely range** from the inputs open data leaves uncertain:

- **Urban CO₂ per resident:** from the median to the mean block of each land-use type in Wang et al. (2019). Transferring Eindhoven values to other cities adds uncertainty that is not shown.
- **TOD transit standard:** from rapid transit only (as if no bus or tram ran every 15 minutes) with longer detours around blocks, to every connected stop with shorter detours.
- **Housing capacity:** ±20 % on today's living space, and 45–75 % of new floor area as living space.

## Source check

Every locked value was checked against its source paper. Corrections compared with the thesis:

- **Emission factors** come from Wang, Han & de Vries (2019), not Yang et al. They are per m² of land, as the thesis used them.
- **Green uptake:** −25 and −7 kg/m² are carbon *stocks* (Whittinghill et al., 2014), not yearly uptake. They are replaced by yearly rates.
- **3.2 kg CO₂** is daily travel CO₂ per person (Brand et al., 2021), not per car trip.
- **0.35** is the 35 % reduction in car trips in TOD versus transit-adjacent areas (Park et al., 2018). The app uses the matching 39 % reduction in car distance, since CO₂ follows distance.
- **The 70 % share of residents who drive** had no source and is no longer used.

## Validation

| Check | Result |
|---|---|
| Residents | EU Census 2021 1 km grid (Eurostat), placed inside each square kilometre with GHS-POP 2020 pixels; GHS-POP alone outside the census countries |
| Class 1–3 areas vs Urban Atlas 2018, calibration samples | within 1 % in total; 50 % cell agreement |
| Class 1–3 areas vs Urban Atlas 2018, unseen samples | 43 % cell agreement |
| Growth hindcast 2006 → 2018, urban/non-urban agreement | 96.5 % (persistence included) |
| Growth hindcast, new urban cells found | 6.0 % vs 4.7 % for random placement |
| Growth hindcast, growth within 200 m of real new land | 31.7 % vs 28.2 % for random placement |

### Against official city CO₂ inventories

Eight cities were run through the app (a box about the size of each municipality) and compared
with the Moran et al. (2022) inventory of 108,000 European cities (2018, national inventories
spread to municipalities).

| City | Residents, app / inventory | Urban CO₂ per resident, app | Buildings + road fuel per resident, inventory |
|---|---|---|---|
| Leuven | 103k / 92k | 4.38 t | 3.98 t |
| Graz | 300k / 277k | 4.36 t | 3.19 t |
| Eindhoven | 239k / 221k | 3.49 t | 2.45 t |
| Ljubljana | 298k / 291k | 2.98 t | 2.29 t |
| Utrecht | 331k / 335k | 2.12 t | 1.68 t |
| Bologna | 441k / 371k | 2.03 t | 1.96 t |
| Lyon | 492k / 483k | 1.22 t | 0.62 t |
| Zaragoza | 626k / 661k | 0.89 t | 1.21 t |

- **Residents:** within 0–19 % of official counts. The differences come from the square box not matching municipal borders.
- **CO₂ per resident ranks cities the same way the inventory does:** Spearman 0.95, Pearson 0.94.
- **The app is higher, by a median of 1.28×,** as expected. The inventory's building sector counts only fuel burned in buildings, while the land-use factors also include electricity and daily life. The gap is largest in Lyon, where nuclear power keeps building electricity off the French inventory.
- **Car CO₂ per resident is not city-specific.** It starts from a European average (Brand et al., 2021) and only changes with density relative to the same city and with TOD.

### TOD scores against real data

| Check | Compared with | Result |
|---|---|---|
| Block sides (3.A.1) | Full OpenStreetMap (Overpass), the same network rules, three station areas | Map tiles drop many of the shared points where streets meet: matching them on shared points found 423 block sides around Utrecht Centraal with 90 % under 210 m, against 1,027 and 106 m in full OSM. Junctions are now found geometrically. Tiles / full OSM, 90 % under: Utrecht 106 / 106 m, Porto São Bento 128 / 120 m, Gouda 113 / 115 m; same points in all three |
| Walking distance to transit (4.A.1) | OSRM foot routes on OpenStreetMap, 80 homes in Utrecht and Rome | Grid paths were 7–20 % shorter than real routes. A detour factor of 1.2 (the median ratio) now applies; on the 1000 m / 500 m test the app agrees with the router for 62 of 63 homes |
| Rapid transit stops | Station lists, Utrecht and Rome | Rail, metro and light-rail stops are right. Ten canal-boat ferry stops in Utrecht had counted as rapid transit; ferries now count as direct services |
| Roadway area (8.A.3) | Urban Atlas 2018 road and rail land, four Rome areas | First estimate exceeded Urban Atlas, which also counts sidewalks. After halving dual carriageways and giving service roads 4 m, the app is 83–85 % of Urban Atlas in central Rome and close to it in the suburbs |
| Floor area per resident | Average dwelling size (Eurostat 2019, in Appolloni & D'Alessandro, 2021) ÷ household size, 8 cities | Right order of magnitude: about 0.8 × app gross area gives 31–68 m² against national averages of 40–50 m². Individual cities differ by up to ±50 % |

### Across settlement sizes

Twenty places, five of each size, framed on their centre (6 km for big cities, 4 km for mid-size
cities, 3 km for towns, 2 km for villages), scored as built with residents from the EU census grid.
Hallstatt's rail station is across the lake, reached by ferry.

| Place | Size | TOD score (of 45) | Short blocks: 90 % of sides under → points (of 10) | Daily needs: % of buildings within reach of food / school / health → points (of 3) | Park within 500 m, % of buildings → point (of 1) | Densify, Compact, Shift (of 31) |
|---|---|---|---|---|---|---|
| Porto | big | 32 | 134 m → 6 | 100 / 100 / 100 → 3 | 70 → 0 | 23 |
| Paris (Châtelet) | big | 42 | 108 m → 10 | 100 / 100 / 100 → 3 | 100 → 1 | 28 |
| Berlin (Mitte) | big | 36 | 118 m → 8 | 95 / 91 / 100 → 3 | 100 → 1 | 24 |
| Madrid (Sol) | big | 40 | 113 m → 8 | 100 / 100 / 100 → 3 | 95 → 1 | 28 |
| Warsaw | big | 25 | 186 m → 2 | 97 / 99 / 100 → 3 | 99 → 1 | 19 |
| Utrecht | mid | 40 | 104 m → 10 | 90 / 97 / 99 → 3 | 99 → 1 | 26 |
| Bologna | mid | 36 | 137 m → 6 | 98 / 99 / 100 → 3 | 98 → 1 | 26 |
| Ghent | mid | 31 | 134 m → 6 | 97 / 100 / 100 → 3 | 100 → 1 | 21 |
| Freiburg | mid | 34 | 126 m → 8 | 74 / 100 / 100 → 2 | 97 → 1 | 23 |
| Aarhus | mid | 35 | 122 m → 8 | 77 / 95 / 98 → 2 | 89 → 1 | 24 |
| Chur | town | 37 | 106 m → 10 | 98 / 100 / 100 → 3 | 100 → 1 | 23 |
| Évora | town | 24 | 166 m → 4 | 73 / 100 / 98 → 2 | 76 → 0 | 18 |
| Gouda | town | 27 | 113 m → 8 | 74 / 100 / 91 → 2 | 100 → 1 | 16 |
| Kutná Hora | town | 25 | 139 m → 6 | 59 / 100 / 81 → 2 | 75 → 0 | 17 |
| Ystad | town | 32 | 118 m → 8 | 75 / 96 / 86 → 2 | 81 → 1 | 21 |
| Zermatt | village | 24 | 247 m → 0 | 83 / 71 / 100 → 2 | 75 → 0 | 22 |
| Hallstatt | village | 8 | 452 m → 0 | 93 / 74 / 40 → 1 | 74 → 0 | 7 |
| Giethoorn | village | 0 (no station) | – | – | – | 0 |
| Óbidos | village | 14 | 241 m → 0 | 0 / 98 / 98 → 2 | 98 → 1 | 11 |
| Grindelwald | village | 19 | 315 m → 0 | 58 / 97 / 100 → 2 | 44 → 0 | 17 |

Densify, Compact and Shift in detail:

| Place | Residents per ha within 1000 m → points (of 8) | Cubes with shops and services, % 500 m / 1000 m / city → points (of 7) | Built-up share of developable land, % → points (of 8) | Other transit options → points (of 2) | Road share of land, % → points (of 6) |
|---|---|---|---|---|---|
| Porto | 50 → 3 | 47 / 41 / 14 → 7 | 100 → 8 | bike share → 2 | 15 → 3 |
| Paris (Châtelet) | 179 → 8 | 32 / 43 / 35 → 4 | 100 → 8 | bike share → 2 | 15 → 6 |
| Berlin (Mitte) | 84 → 4 | 31 / 33 / 29 → 4 | 100 → 8 | bike share → 2 | 12 → 6 |
| Madrid (Sol) | 341 → 8 | 53 / 52 / 21 → 7 | 100 → 8 | bike share → 2 | 16 → 3 |
| Warsaw | 54 → 3 | 4 / 11 / 17 → 0 | 96 → 8 | bike share → 2 | 8 → 6 |
| Utrecht | 107 → 6 | 26 / 28 / 13 → 4 | 100 → 8 | bike share → 2 | 13 → 6 |
| Bologna | 122 → 7 | 17 / 16 / 17 → 3 | 100 → 8 | bike share → 2 | 14 → 6 |
| Ghent | 95 → 5 | 20 / 17 / 20 → 3 | 99 → 8 | bike share → 2 | 17 → 3 |
| Freiburg | 52 → 3 | 20 / 27 / 21 → 4 | 98 → 8 | bike share → 2 | 8 → 6 |
| Aarhus | 81 → 4 | 47 / 57 / 36 → 4 | 100 → 8 | bike share → 2 | 14 → 6 |
| Chur | 76 → 4 | 16 / 13 / 20 → 3 | 100 → 8 | bike share → 2 | 14 → 6 |
| Évora | 39 → 2 | 7 / 23 / 17 → 4 | 100 → 8 | bus → 1 | 15 → 3 |
| Gouda | 77 → 4 | 10 / 13 / 15 → 0 | 100 → 8 | bus → 1 | 15 → 3 |
| Kutná Hora | 44 → 2 | 8 / 14 / 23 → 0 | 98 → 8 | bus → 1 | 13 → 6 |
| Ystad | 46 → 2 | 34 / 33 / 31 → 7 | 100 → 8 | bus → 1 | 20 → 3 |
| Zermatt | 40 → 2 | 21 / 17 / 15 → 7 | 81 → 6 | bus → 1 | 0 (car-free) → 6 |
| Hallstatt | 3 → 0 | 0 / 3 / 5 → 0 | 56 → 0 | bus → 1 | 4 → 6 |
| Giethoorn | – | – | – | – | – |
| Óbidos | 5 → 0 | 3 / 11 / 8 → 4 | 28 → 0 | bus → 1 | 7 → 6 |
| Grindelwald | 16 → 1 | 12 / 10 / 8 → 7 | 60 → 2 | bus → 1 | 6 → 6 |

The first version of Densify followed the Standard more literally: floor area of homes and of
other uses near the station against the densest 10 % of similar districts in the frame. It was
fragile. Floor area rests on building heights that the map often lacks, and the benchmark moved
with the frame. After residents were scaled to the census, Utrecht Centraal fell from 109 % to
87 % of its benchmark and lost all Densify points. Densify now uses only residents (census) and
mapped shops and services (OpenStreetMap). A residents-only check of "densest by the station" was
tried and dropped: historic centres have fewer residents than the rest of the city (Porto 50 per
ha within 1000 m against 66 in the built-up city, Châtelet 179 against 242), because shops and
offices fill them.

What the scan changed:

- **Built-up land (7.A.1).** Cells without a land-use tag and with few buildings used to count as
  fields. In city centres these are squares, surface car parks and cleared lots, which the Standard
  counts as built-up ("previously developed sites that have been cleared"), and so are building
  sites. Only land the map shows as farmland or nature now counts as not built (central Warsaw: 2 →
  8 points; villages keep their fields: Hallstatt 56 %, Óbidos 28 %).
- **Green streets.** "Roads → green streets" (Retrofitting, Balanced) drew from all transport land,
  so most of it landed on rail yards, and a greened street still counted as roadway. It now takes
  only cells with a street, removes their roadway from 8.A.3, plants a tree on each, and shows them
  as "New urban green" in Changes (Porto: road share 16 % → 14 %, Shift 3 → 6 points).
- **Roadway (8.A.3).** Parking aisles and driveways are off-street parking (the Standard's 8.A.1),
  not roadway; they no longer count. Car-free Zermatt scores 0 % road. Road widths remain typical
  values per road type, as the map rarely records them, so shares near the 15 % and 20 % steps
  (Porto, Évora, Gouda, Ystad) could fall either side.

- **Tower outlines.** Some building outlines carry the height of their tallest part over the whole footprint (Warsaw's Palace of Culture: 237 m over 2 ha), which put 28,000 m² of offices on each hectare around Warszawa Centralna. Building parts inside a larger outline now give the heights.
- **Mixed use.** Shops and offices on the ground floor of homes were invisible, so historic centres scored as purely residential (Madrid Sol: 15 % of the benchmark). Where the map shows a shop, café, office or public service in a residential cell, its ground floor now counts as non-residential (Madrid Sol: 140 %), and the similar-district filter of the benchmark works again.
- **Edge districts.** Benchmark circles mostly outside the frame measured too little land; circles need three quarters of their area inside the frame.
- **No station, no points.** A place without rail, metro or BRT (Giethoorn) scored 6 Shift points on an empty catchment; Compact and Shift now need a station area.
- **Sparse places (⚠).** CO₂ per m² of land comes from city blocks. Below 40 residents per hectare of housing land each resident carries a lot of land, and holiday homes or hotels add floor space without residents, so the app marks CO₂ per resident as overstated and asks to compare strategies rather than places.

Low residential scores in historic centres (Porto, Freiburg, Évora) are real: few people live
there. Warsaw Centralna sits among wide roads and the open square of the Palace of Culture, which
leaves few mapped shops within 1000 m.

- **Still unverifiable from open data:** service frequency (every 15 minutes), so the transit share is an upper bound, and whether a bus stop on a busway is real BRT.
- **Within reach of open data but not yet checked:** completeness outside western Europe.

The growth step reproduces how much a city grows but locates new land only slightly better than
chance, so it is presented as speculation. Changing the weights of the four growth terms moved the
hindcast by less than 1.5 points, so the thesis TM_S equal weights are kept.

### Housing the newcomers across settlement sizes

The same 20 places, simulated to 2050 with each policy and no new stations (scan of 31 October
2026). Each cell shows the people given a home · the new land used. Housed counts the newcomers
plus residents whose homes a policy turned into shops or parks, who need a new home too. For
Baseline, "green" is the part of its new land taken from parks and urban green.

**Country trend, up to +5 % new land** (the defaults). Where Eurostat projects the country to
shrink, no new homes are needed (—):

| Place | Size | Trend to 2050 | Newcomers | Baseline | Intense Building | Retrofitting | Balanced |
|---|---|---|---|---|---|---|---|
| Porto | big | −7% | — | — | — | — | — |
| Paris (Châtelet) | big | +2.9% | 23,783 | 13,909 · 152 ha (150 green) | 5,100 · 2 ha | 13,022 · 2 ha | 2,934 · 2 ha |
| Berlin (Mitte) | big | −0.5% | — | — | — | — | — |
| Madrid (Sol) | big | +3.8% | 30,447 | 12,365 · 136 ha (120 green) | 15,469 · 41 ha | 12,451 · 41 ha | 10,420 · 41 ha |
| Warsaw | big | −9.8% | — | — | — | — | — |
| Utrecht | mid | +3.9% | 5,275 | 2,753 · 57 ha (54 green) | 5,042 · 18 ha | 2,719 · 18 ha | 3,260 · 18 ha |
| Bologna | mid | −2.4% | — | — | — | — | — |
| Ghent | mid | +6.2% | 6,727 | 2,185 · 62 ha (53 green) | 3,605 · 18 ha | 3,892 · 18 ha | 2,400 · 18 ha |
| Freiburg | mid | −0.5% | — | — | — | — | — |
| Aarhus | mid | +2.8% | 2,512 | 1,567 · 49 ha (36 green) | 2,683 · 0 ha | 2,754 · 0 ha | 3,237 · 0 ha |
| Chur | town | +9.1% | 2,692 | 279 · 23 ha (13 green) | 2,732 · 0 ha | 1,242 · 23 ha | 2,386 · 23 ha |
| Évora | town | −7% | — | — | — | — | — |
| Gouda | town | +3.9% | 1,643 | 1,329 · 25 ha (23 green) | 1,680 · 0 ha | 1,711 · 0 ha | 1,810 · 0 ha |
| Kutná Hora | town | −2.5% | — | — | — | — | — |
| Ystad | town | +13.3% | 2,216 | 389 · 26 ha (6 green) | 2,342 · 0 ha | 2,243 · 0 ha | 2,443 · 26 ha |
| Zermatt | village | +9.1% | 501 | 171 · 6 ha (4 green) | 509 · 0 ha | 139 · 6 ha | 519 · 6 ha |
| Hallstatt | village | +4.6% | 25 | 15 · 1 ha | 34 · 0 ha | 23 · 1 ha | 30 · 0 ha |
| Giethoorn | village | +3.9% | 39 | 31 · 2 ha (1 green) | 49 · 0 ha | 22 · 2 ha | 102 · 0 ha |
| Óbidos | village | −7% | — | — | — | — | — |
| Grindelwald | village | +9.1% | 161 | 8 · 4 ha (1 green) | 195 · 0 ha | 80 · 4 ha | 216 · 1 ha |

**Fast growth (+25 %), up to +30 % new land.** "Free land" is the land each kind of growth could
find in the frame: Baseline may build on parks, TOD keeps them and protected areas free. The last
column is CO₂ per resident in 2050 (t a year) for Baseline / IB / RETRO / BAL:

| Place | Newcomers | Free land, Baseline / TOD | Baseline | Intense Building | Retrofitting | Balanced | CO₂ per resident |
|---|---|---|---|---|---|---|---|
| Porto | 52,948 | 473 / 186 ha | 13,888 · 473 ha (287 green) | 19,905 · 186 ha | 11,564 · 186 ha | 13,548 · 186 ha | 2.11 / 1.87 / 1.84 / 1.90 |
| Paris (Châtelet) | 205,732 | 152 / 2 ha | 13,909 · 152 ha (150 green) | 5,100 · 2 ha | 13,022 · 2 ha | 2,934 · 2 ha | 0.48 / 0.46 / 0.43 / 0.46 |
| Berlin (Mitte) | 101,573 | 404 / 22 ha | 34,767 · 404 ha (382 green) | 21,492 · 22 ha | 31,539 · 22 ha | 14,003 · 22 ha | 2.03 / 1.85 / 1.69 / 1.87 |
| Madrid (Sol) | 200,310 | 418 / 41 ha | 31,803 · 418 ha (378 green) | 15,469 · 41 ha | 12,451 · 41 ha | 10,420 · 41 ha | 1.13 / 1.00 / 0.95 / 0.99 |
| Warsaw | 70,900 | 664 / 73 ha | 49,146 · 664 ha (591 green) | 24,569 · 73 ha | 33,214 · 73 ha | 17,172 · 73 ha | 1.68 / 1.47 / 1.34 / 1.51 |
| Utrecht | 34,255 | 221 / 18 ha | 7,113 · 221 ha (203 green) | 5,042 · 18 ha | 2,719 · 18 ha | 3,260 · 18 ha | 1.88 / 1.64 / 1.58 / 1.64 |
| Bologna | 33,323 | 317 / 81 ha | 14,210 · 317 ha (236 green) | 11,655 · 81 ha | 10,358 · 81 ha | 8,539 · 81 ha | 2.27 / 1.96 / 1.88 / 1.98 |
| Ghent | 27,256 | 159 / 18 ha | 4,766 · 159 ha (140 green) | 3,605 · 18 ha | 3,892 · 18 ha | 2,400 · 18 ha | 3.19 / 2.92 / 2.74 / 2.91 |
| Freiburg | 27,083 | 285 / 35 ha | 11,526 · 285 ha (250 green) | 10,441 · 35 ha | 6,587 · 35 ha | 6,860 · 35 ha | 2.94 / 2.52 / 2.43 / 2.57 |
| Aarhus | 22,112 | 148 / 26 ha | 4,052 · 148 ha (121 green) | 7,077 · 26 ha | 6,765 · 26 ha | 4,385 · 26 ha | 3.71 / 3.32 / 3.14 / 3.40 |
| Chur | 7,365 | 135 / 52 ha | 737 · 135 ha (101 green) | 4,507 · 52 ha | 1,927 · 52 ha | 3,071 · 52 ha | 3.22 / 2.81 / 2.89 / 2.90 |
| Évora | 6,040 | 158 / 158 ha | 2,284 · 158 ha (32 green) | 5,717 · 158 ha | 3,889 · 158 ha | 4,481 · 158 ha | 5.47 / 4.93 / 5.02 / 5.12 |
| Gouda | 10,668 | 153 / 89 ha | 5,579 · 153 ha (95 green) | 7,429 · 89 ha | 5,814 · 89 ha | 6,041 · 89 ha | 2.87 / 2.54 / 2.49 / 2.59 |
| Kutná Hora | 4,035 | 132 / 132 ha | 1,556 · 132 ha (25 green) | 4,141 · 62 ha | 3,826 · 132 ha | 4,039 · 132 ha | 2.58 / 2.07 / 2.20 / 2.32 |
| Ystad | 4,162 | 113 / 85 ha | 2,157 · 113 ha (27 green) | 4,288 · 64 ha | 4,189 · 77 ha | 3,761 · 85 ha | 6.49 / 5.49 / 5.22 / 5.84 |
| Zermatt | 1,371 | 34 / 34 ha | 302 · 34 ha (15 green) | 815 · 34 ha | 185 · 34 ha | 565 · 34 ha | 2.18 / 1.91 / 2.01 / 1.96 |
| Hallstatt | 136 | 9 / 9 ha | 24 · 9 ha (5 green) | 82 · 9 ha | 19 · 9 ha | 55 · 9 ha | 17.76 / 15.71 / 16.28 / 16.09 |
| Giethoorn | 255 | 9 / 9 ha | 67 · 9 ha (5 green) | 264 · 0 ha | 100 · 9 ha | 317 · 5 ha | 8.03 / 6.27 / 8.07 / 6.98 |
| Óbidos | 254 | 25 / 25 ha | 47 · 25 ha (2 green) | 265 · 17 ha | 108 · 25 ha | 222 · 25 ha | 18.54 / 15.55 / 17.13 / 16.56 |
| Grindelwald | 440 | 25 / 25 ha | 93 · 25 ha (5 green) | 471 · 25 ha | 141 · 25 ha | 327 · 25 ha | 18.95 / 15.66 / 17.20 / 16.88 |

What the scan shows:

- **Half the places need no new homes on the country trend.** Portugal, Poland, Italy, Czechia and
  Germany are projected to shrink by 2050. A city can still grow while its country shrinks, which
  is why the player can change the figure.
- **Baseline builds on parks.** In the cities, 61–99 % of Baseline's new land is parks and urban
  green (Warsaw 591 of 664 ha, Berlin 382 of 404 ha), because the frame has little farmland left.
  TOD policies keep that land free.
- **Building up near transit houses more people on less land** in the towns and villages and in
  Porto, Aarhus and Gouda: Intense Building houses every newcomer in Kutná Hora on 62 ha, where
  Baseline houses 39 % of them on 132 ha.
- **Dense cities cannot house fast growth either way.** Paris, Madrid, Utrecht and Ghent have
  almost no free land outside parks, and the thesis rule shares cap how much they can build up, so
  most newcomers are left without a home. In the big cities Baseline often houses more people,
  but only by building over parks. Raising the shares in Custom closes the gap.
- **Retrofitting and Balanced displace residents.** Their rules turn some homes into shops, parks
  or streets (Paris, Balanced: 5,667 residents), who then need homes too, so they house fewer
  newcomers than Intense Building.
- **CO₂ per resident** with fast growth is 4–17 % lower with every TOD policy than with Baseline,
  except Retrofitting in Giethoorn (0.5 % higher: it houses few people on its new land).
- **Speed.** A place takes 10–140 s to scan; most of it is the growth model at +30 % land.

## Run it locally

```bash
npm install
npm run dev
```

## Deploy

Pushing to `main` builds the site and publishes it to GitHub Pages through
`.github/workflows/deploy.yml`. In the repository settings, set **Pages → Source** to **GitHub Actions**.

## Data and credits

- Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL.
  Vector tiles © [OpenMapTiles](https://openmaptiles.org), served free by [OpenFreeMap](https://openfreemap.org).
- Population: Schiavina et al. (2023), GHS-POP R2023A, European Commission JRC,
  [doi:10.2905/2FF68A52-5B5B-4A22-8F40-C41DA8332CFE](https://doi.org/10.2905/2FF68A52-5B5B-4A22-8F40-C41DA8332CFE), CC BY 4.0;
  cloud-optimised mirror on [Source Cooperative](https://source.coop/cboettig/population).
- Elevation: [AWS Terrain Tiles](https://github.com/tilezen/joerd/blob/master/docs/attribution.md) (SRTM, Copernicus/EU-DEM and others).
- Place search: [Nominatim](https://nominatim.org).
- TOD metrics: ITDP (2017), *TOD Standard*, 3rd edition.
- Visual style after the isometric illustrations by Anastasia Logvinenko (2025), used with permission.
- Indicator references: see the in-app *References and locked assumptions* panel.

## License

MIT, see [LICENSE](LICENSE).
