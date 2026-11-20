// Transmet les erreurs des contrôleurs async au middleware d'erreurs.
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export default asyncHandler;
