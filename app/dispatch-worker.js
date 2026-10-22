// Background dispatch solver: keeps the page responsive while a year or more of hourly dispatch is optimised.
import { batteryDispatch, hybridDispatch } from './economics.js';

self.onmessage = e => {
  const { id, kind, records, config } = e.data;
  let result;
  try { result = (kind === 'hybrid' ? hybridDispatch : batteryDispatch)(records, config); }
  catch (err) { result = { summary: {}, rows: [], assumptions: [], errors: [`Dispatch failed: ${err.message}`] }; }
  self.postMessage({ id, result });
};
