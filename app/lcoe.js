// Levelised cost on the same timeline as projectFinance: capital at year 0, construction years with no
// output, operations in years constructionYears+1 … constructionYears+years.
// LCOE = PV(capital + O&M) ÷ PV(MWh), i.e. the flat $/MWh whose revenue has the same present value as costs.
const finite = x => typeof x === 'number' && Number.isFinite(x);

export function lcoe({ capex, annualOM, rate, years, constructionYears = 0, mwh }) {
  if (!Array.isArray(mwh) || mwh.length < years || mwh.slice(0, years).some(m => !finite(m) || m < 0)) return { value: null, reason: 'MWh per operating year not held' };
  if (![capex, annualOM, rate].every(finite) || rate <= -1) return { value: null, reason: 'Invalid cost or rate' };
  const df = t => 1 / (1 + rate) ** t, first = constructionYears + 1;
  let pvCost = capex, pvMWh = 0;
  for (let k = 0; k < years; k++) { pvCost += annualOM * df(first + k); pvMWh += mwh[k] * df(first + k); }
  if (!(pvMWh > 0)) return { value: null, reason: 'No discounted output' };
  const annuity = Array.from({ length: years }, (_, k) => df(first + k)).reduce((a, b) => a + b, 0);
  return { value: pvCost / pvMWh, pvCost, pvMWh, annuityFactor: annuity, capexAtCOD: capex * (1 + rate) ** constructionYears };
}
