import { api, setToken } from '../api';

type AuthResult = { token: string; user: { id: string; name: string } };

export function renderLogin(app: HTMLElement, onDone: () => void): void {
  let setup = false;
  app.replaceChildren();
  const form = document.createElement('form');
  form.className = 'login';
  form.innerHTML = `
    <h1>AI 기억장</h1>
    <p class="hint" id="mode-hint"></p>
    <label>이름<input name="name" autocomplete="username" required /></label>
    <label>비밀번호<input name="password" type="password" autocomplete="current-password" required /></label>
    <p class="error" id="msg" role="alert" hidden></p>
    <button type="submit" class="primary" id="submit"></button>
    <button type="button" class="link" id="toggle"></button>`;
  app.append(form);
  const $ = <T extends HTMLElement>(id: string) => form.querySelector<T>('#' + id)!;
  const msg = $('msg');

  const paint = () => {
    $('mode-hint').textContent = setup ? '처음이에요. 사용할 이름과 비밀번호를 정해 주세요' : '로그인해 주세요';
    $('submit').textContent = setup ? '설정하고 시작' : '로그인';
    $('toggle').textContent = setup ? '이미 계정이 있어요' : '처음 설정';
    form.querySelector<HTMLInputElement>('input[name=password]')!.autocomplete = setup ? 'new-password' : 'current-password';
  };
  const show = (text: string) => { msg.textContent = text; msg.hidden = !text; };
  paint();

  $('toggle').addEventListener('click', () => { setup = !setup; show(''); paint(); });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = $<HTMLButtonElement>('submit');
    const fd = new FormData(form);
    btn.disabled = true;
    show('');
    try {
      const r = await api<AuthResult>(setup ? '/setup' : '/login', {
        method: 'POST',
        body: JSON.stringify({ name: String(fd.get('name') ?? '').trim(), password: String(fd.get('password') ?? '') }),
      });
      setToken(r.token);
      onDone();
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (setup && status === 409) { setup = false; paint(); }
      show(e instanceof Error ? e.message : '문제가 생겼어요');
    } finally {
      btn.disabled = false;
    }
  });
}
