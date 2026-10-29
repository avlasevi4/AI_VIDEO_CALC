(function () {
  'use strict';
  function normalize(value = {}) {
    return {
      displayCurrency: value.displayCurrency === 'USD' ? 'USD' : 'RUB',
      showDreaminaPlus: value.showDreaminaPlus !== false
    };
  }
  function formatMoney(rub, settings = {}, maximumFractionDigits = 2) {
    const amount = Number(rub);
    const usd = normalize(settings).displayCurrency === 'USD';
    const rate = Number(settings.usdRub);
    if (!Number.isFinite(amount) || (usd && (!Number.isFinite(rate) || rate <= 0))) return '—';
    const value = usd ? amount / rate : amount;
    return value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits }) + (usd ? ' $' : ' ₽');
  }
  function showPrivateProvider(isOwner, settings) {
    return Boolean(isOwner) && normalize(settings).showDreaminaPlus;
  }
  window.AIVideoPreferences = Object.freeze({ normalize, formatMoney, showPrivateProvider });
})();
