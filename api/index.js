// Vercel 서버리스 함수 진입점: 모든 요청(vercel.json 의 rewrites)이 이 Express 앱으로 들어온다.
import app from '../src/app.js';

export default app;
