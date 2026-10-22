// 로컬 Docker DB(docker-compose.yml) 주소. 비밀값이 아니라서 코드 기본값으로 둔다.
// .env나 Vercel 환경변수에 DATABASE_URL·DIRECT_URL이 있으면 그 값을 쓴다.
export const LOCAL_DATABASE_URL = 'postgresql://postgres:postgres@localhost:5433/travelpass'
