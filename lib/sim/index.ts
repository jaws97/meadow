// The plant simulation's public API: the locked model (SIM_VERSION 4), game time, Bangalore weather from Open-Meteo,
// the climate normal behind the bloom forecast, and the replay the server runs to bring a stored plant up to date.
// Framework-free and pure apart from weather.ts's fetch helpers, so the same code runs on the server, in tests and in
// the browser.
export {
  SIM_VERSION,
  GAME_START,
  BED,
  SIM_SPECIES,
  TWIN,
  PLANT_LINES,
  createPlant,
  step,
  toVisual,
  expectBloom,
  canPlant,
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
  HourInput,
  HourWeather,
  OnOff,
  PlantLine,
  PlantMood,
  PlantState,
  SimEvent,
  SimEventKind,
  SimSpecies,
  TwinEntry,
  Visual,
} from "./model";
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
