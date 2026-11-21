// 공통 응답 도구: CORS, json, HttpError
export const CORS = {
  'Access-Control-Allow-Origin': '*', // 쿠키 없이 토큰으로만 인증하므로 출처 제한이 없어도 됨
  'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
};

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });
