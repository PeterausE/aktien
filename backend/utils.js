function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function gainLoss(currentTotalValue, menge, kaufpreisPerEinheit) {
  const cost = menge * kaufpreisPerEinheit;
  const absolute = currentTotalValue - cost;
  const percent = cost !== 0 ? (absolute / cost) * 100 : 0;
  return { absolute, percent };
}

module.exports = { asyncHandler, gainLoss };
