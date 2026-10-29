// O caminho do módulo é estável mesmo após pushState ou em /Ominidata/.
if ('serviceWorker' in navigator) {
  const registrar = () => navigator.serviceWorker.register(new URL('../../service-worker.js', import.meta.url), {
    updateViaCache: 'none'
  }).catch(error => console.warn('Não foi possível atualizar o cache do aplicativo:', error));
  if (document.readyState === 'complete') registrar();
  else window.addEventListener('load', registrar, { once: true });
}
