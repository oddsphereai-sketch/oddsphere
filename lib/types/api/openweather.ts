/**
 * OpenWeather API response shapes.
 * Source: https://openweathermap.org/api · 5-day/3-hour forecast endpoint.
 * Units: requested with `units=imperial` (Fahrenheit, mph).
 */

export type OpenWeatherWeatherDescriptor = {
  id: number;
  main: string; // 'Clear', 'Rain', 'Clouds', etc.
  description: string;
  icon: string;
};

export type OpenWeatherForecastItem = {
  dt: number; // Unix timestamp (seconds)
  dt_txt: string; // 'YYYY-MM-DD HH:MM:SS'
  main: {
    temp: number; // °F
    feels_like: number;
    humidity: number; // %
    pressure: number;
    temp_min?: number;
    temp_max?: number;
  };
  weather: OpenWeatherWeatherDescriptor[];
  wind: {
    speed: number; // mph
    deg: number; // 0-360
    gust?: number;
  };
  rain?: { "3h"?: number }; // mm
  snow?: { "3h"?: number };
  pop?: number; // 0-1 probability of precipitation
  clouds?: { all: number };
  visibility?: number;
};

export type OpenWeatherForecastResponse = {
  cod: string;
  message: number;
  cnt: number;
  list: OpenWeatherForecastItem[];
  city: {
    id: number;
    name: string;
    coord: { lat: number; lon: number };
    country: string;
    timezone: number;
    sunrise?: number;
    sunset?: number;
  };
};
