// The plant simulation's public API: the locked soil model (SIM_VERSION 7) for the six flowers of the bed, the Lotus's
// pond model (POND_VERSION 1), the one door to both (plant.ts: createPlant, step, toVisual and expectBloom dispatch by
// species and by state), game time, Bangalore weather from Open-Meteo, the climate normal behind the bloom forecast, the
// heavy-rain hint read from the forecast (rainSoon), and the replay the server runs to bring a stored plant up to date.
// Framework-free and pure apart from weather.ts's fetch helpers, so the same code runs on the server, in tests and in
// the browser.
export {
  SIM_VERSION,
  GAME_START,
  BED,
  SIM_SPECIES,
  TWIN,
  PLANT_LINES,
  rainSoon,
  canPlant,
  opensInMorning,
  openWindow,
  cleanWx,
  WX_FALLBACK,
  climAt,
  ttHour,
  devFactor,
  abaSignal,
  Bideal,
  fOf,
  thetaOf,
  leafArea,
  soilN,
  nRich,
  hodOf,
} from "./model";
export type {
  Bed,
  BloomForecast,
  CanAdvice,
  FeedAdvice,
  ForecastRow,
  HourInput,
  HourWeather,
  LooseWeather,
  OnOff,
  PlantLine,
  PlantMood,
  RainSoon,
  SimEvent,
  SimEventKind,
  SimSpecies,
  TwinEntry,
} from "./model";
export {
  POND_MODEL_BASE,
  createPlant,
  step,
  toVisual,
  expectBloom,
  isPondState,
  isPondVisual,
  modelVersionOf,
  modelVersionOfState,
  isCurrentState,
  bloomedAt,
  ripeAt,
  diedAt,
} from "./plant";
export type { PlantState, Visual, SoilState, SoilVisual } from "./plant";
export {
  POND_VERSION,
  POND_NONE,
  POND,
  JAR,
  POND_SPECIES,
  POND_TWIN,
  POND_GEO,
  POND_LINES,
  createPond,
  stepPond,
  expectBloomPond,
  toVisualPond,
  levelMM,
  koiHunger,
  connected,
  pondOpenWindow,
} from "./pond";
export type { KoiAdvice, Pond, PondFeedAdvice, PondLine, PondSpecies, PondState, PondVisual } from "./pond";
export {
  GAME_START_IST,
  GAME_START_MS,
  HOUR_MS,
  IST_OFFSET_MIN,
  PLANT_OPEN_H,
  PLANT_CLOSE_H,
  TYPICAL_BLOOM_DAYS,
  hourIndexOf,
  dateOfHour,
  hod,
  dayOf,
  istHour,
} from "./calendar";
export { CLIM_T, CLIM_T_YEARS } from "./climate";
export {
  WEATHER_CREDIT,
  BLR,
  HOURLY_VARIABLES,
  FORECAST_ENDPOINT,
  ARCHIVE_ENDPOINT,
  buildForecastUrl,
  buildArchiveUrl,
  parseHourly,
  weatherLookup,
  fetchForecast,
  fetchArchive,
} from "./weather";
export type { FetchLike, ForecastOptions, GameHourWeather, ParseOptions } from "./weather";
export { catchUp, replayFromPlanting } from "./replay";
export type { Planting, TimedEvent, WeatherAt } from "./replay";
