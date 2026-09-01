export function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function pick<T>(values: T[]): T {
  return values[Math.floor(Math.random() * values.length)]!;
}
