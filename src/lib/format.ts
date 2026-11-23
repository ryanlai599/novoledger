export function money(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function fmtMoney(n: number): string {
  return money(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function todayIso(): string {
  return new Date().toISOString();
}

export function todayLocalDate(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}
