import { formatCurrency, formatDate } from "../../i18n/format";
export const usd = (value) =>
  value == null ? "—" : formatCurrency(Number(value) === 0 ? 0 : Number(value));
export const day = (value) =>
  value ? formatDate(value, { dateStyle: "short" }) : "—";
