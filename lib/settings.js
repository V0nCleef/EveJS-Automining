"use strict";
const DEFAULT_SURVEY_SECONDS = 60;
const MIN_SURVEY_SECONDS = 6;
const MAX_SURVEY_SECONDS = 86400;
const MAX_ORE_FILTERS = 1024;
const validSurveySeconds = value => Number.isInteger(value) && value >= MIN_SURVEY_SECONDS && value <= MAX_SURVEY_SECONDS;
const surveySeconds = value => validSurveySeconds(value) ? value : DEFAULT_SURVEY_SECONDS;
module.exports = { DEFAULT_SURVEY_SECONDS, MIN_SURVEY_SECONDS, MAX_SURVEY_SECONDS, MAX_ORE_FILTERS, validSurveySeconds, surveySeconds };
