import { NextResponse } from 'next/server'
import { isCronAuthorized } from '@/lib/api/cron.server'
import { completePastBookings } from '@/lib/server/bookings/service'

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const result = await completePastBookings()
  return NextResponse.json(result)
}
