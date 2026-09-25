"use strict";
const DEFAULT_SURVEY_SECONDS = 60;
const MIN_SURVEY_SECONDS = 6;
const MAX_SURVEY_SECONDS = 86400;
const MAX_ORE_FILTERS = 1024;
const DEFAULT_HAUL_THRESHOLD = 95;
const validSurveySeconds = value => Number.isInteger(value) && value >= MIN_SURVEY_SECONDS && value <= MAX_SURVEY_SECONDS;
const surveySeconds = value => validSurveySeconds(value) ? value : DEFAULT_SURVEY_SECONDS;
const validHaulThreshold = value => Number.isInteger(value) && value >= 1 && value <= 100;
const haulThreshold = value => validHaulThreshold(value) ? value : DEFAULT_HAUL_THRESHOLD;
module.exports = { DEFAULT_SURVEY_SECONDS, MIN_SURVEY_SECONDS, MAX_SURVEY_SECONDS, MAX_ORE_FILTERS,
  DEFAULT_HAUL_THRESHOLD, validSurveySeconds, surveySeconds, validHaulThreshold, haulThreshold };
