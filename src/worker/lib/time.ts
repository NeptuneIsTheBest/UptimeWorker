export const DAY = 86_400_000;
export const utcDay = (time: number) => new Date(time).toISOString().slice(0, 10);
export const dayStart = (time: number) => Math.floor(time / DAY) * DAY;
