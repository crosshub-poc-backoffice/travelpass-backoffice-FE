// 서버가 뜰 때 한 번 (Next instrumentation). Node 전용 확인은 따로 불러온다 — Edge 번들에 process.exit 가 들어가지 않게
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') await import('./instrumentation-node')
}
