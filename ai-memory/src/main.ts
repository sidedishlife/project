import './style.css';
import { getToken } from './api';
import { applyTheme } from './theme';
import { mountShell, navigate, registerView } from './router';
import { renderLogin } from './views/login';
import { renderReview } from './views/review';
import { renderInbox } from './views/inbox';
import { renderNotes } from './views/notes';
import { renderSettings } from './views/settings';

registerView('review', (root) => renderReview(root));
registerView('inbox', renderInbox);
registerView('notes', renderNotes);
registerView('settings', renderSettings);

const app = document.getElementById('app')!;
applyTheme();

function start() {
  if (!getToken()) return showLogin();
  mountShell(app);
  void navigate('review');
}
function showLogin() {
  renderLogin(app, start);
}

window.addEventListener('login', showLogin);
start();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* 미지원/차단 환경 */ });
  });
}
