(function () {
  function postLanguage(language) {
    return fetch('/i18n/set-language', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ language })
    });
  }

  function fetchDictionary(language) {
    return fetch('/i18n/' + encodeURIComponent(language) + '.json', {
      cache: 'no-store'
    });
  }

  function handleChange(event) {
    var select = event.target;
    if (!select || !select.value) {
      return;
    }

    var language = select.value;
    var previous = select.getAttribute('data-current-language') || '';
    select.setAttribute('disabled', 'disabled');

    fetchDictionary(language)
      .then(function (response) {
        if (!response.ok) {
          throw new Error('unsupported_language');
        }
        return response.json();
      })
      .then(function () {
        return postLanguage(language);
      })
      .then(function (response) {
        if (!response.ok) {
          throw new Error('persist_failed');
        }
        if (typeof window !== 'undefined') {
          window.location.reload();
        }
      })
      .catch(function (error) {
        console.warn('Falha ao alternar idioma:', error);
        if (typeof window !== 'undefined') {
          window.alert('Não foi possível alternar o idioma. Tente novamente.');
        }
        if (previous) {
          select.value = previous;
        }
      })
      .finally(function () {
        select.removeAttribute('disabled');
      });
  }

  function initSelectors(root) {
    var scope = root || document;
    if (!scope || typeof scope.querySelectorAll !== 'function') {
      return;
    }
    var selects = scope.querySelectorAll('[data-language-selector]');
    selects.forEach(function (select) {
      select.removeEventListener('change', handleChange);
      select.addEventListener('change', handleChange);
    });
  }

  if (document.readyState !== 'loading') {
    initSelectors(document);
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      initSelectors(document);
    });
  }

  document.addEventListener('htmx:afterSwap', function (event) {
    initSelectors(event.target || document);
  });
})();
