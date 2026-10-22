import { NextResponse } from 'next/server'
import { completePastBookings } from '@/lib/server/bookings/service'

export async function GET(request: Request) {
  const auth = request.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const result = await completePastBookings()
  return NextResponse.json(result)
}
