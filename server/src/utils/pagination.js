// Convertit page/limit en paramètres skip/take pour Prisma.
export const getPagination = ({ page = 1, limit = 10 } = {}) => ({
  page,
  limit,
  skip: (page - 1) * limit,
  take: limit,
});
