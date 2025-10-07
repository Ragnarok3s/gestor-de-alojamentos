(function () {
  if (typeof window === "undefined") return;
  if (window.__featureBuilderBootstrapLoaded) {
    if (!window.__featureBuilderPresets) {
      window.__featureBuilderPresets = __FEATURE_PRESETS__;
    }
    if (typeof window.__initFeatureBuilders === "function") {
      window.__initFeatureBuilders();
    }
    return;
  }

  window.__featureBuilderBootstrapLoaded = true;

  var featurePresets = __FEATURE_PRESETS__;
  window.__featureBuilderPresets = featurePresets;

  var presetMap = featurePresets.reduce(function (acc, item) {
    acc[item.icon] = item;
    return acc;
  }, {});

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      switch (char) {
        case "&":
          return "&amp;";
        case "<":
          return "&lt;";
        case ">":
          return "&gt;";
        case '"':
          return "&quot;";
        case "'":
          return "&#39;";
        default:
          return char;
      }
    });
  }

  function formatPresetLabel(icon, quantity) {
    var preset = presetMap[icon];
    var safeQuantity = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
    if (!preset) return String(safeQuantity);
    var noun = safeQuantity === 1 ? preset.singular : preset.plural;
    return safeQuantity + " " + noun;
  }

  function serializeEntry(entry) {
    if (entry.raw) return entry.raw;
    return entry.icon + "|" + formatPresetLabel(entry.icon, entry.quantity);
  }

  function initFeatureBuilder(root) {
    if (!root || root.dataset.featureBuilderReady === "true") return;
    var select = root.querySelector("[data-feature-select]");
    var quantityInput = root.querySelector("[data-feature-quantity]");
    var addButton = root.querySelector("[data-feature-add]");
    var list = root.querySelector("[data-feature-list]");
    var output = root.querySelector("[data-feature-output]");
    if (!select || !quantityInput || !addButton || !list || !output) return;

    var emptyText = list.getAttribute("data-empty-text") || "";
    var entries = [];

    function render() {
      if (!entries.length) {
        list.innerHTML = emptyText
          ? '<li class="feature-builder__empty">' + escapeHtml(emptyText) + "</li>"
          : "";
      } else {
        list.innerHTML = entries
          .map(function (entry, index) {
            if (entry.raw) {
              return (
                '<li class="feature-builder__item feature-builder__item--legacy" data-feature-item data-index="' +
                index +
                '"><span>' +
                escapeHtml(entry.raw) +
                '</span><button type="button" class="feature-builder__remove" data-feature-remove aria-label="Remover entrada personalizada">×</button></li>'
              );
            }
            var label = formatPresetLabel(entry.icon, entry.quantity);
            return (
              '<li class="feature-builder__item" data-feature-item data-index="' +
              index +
              '"><span class="feature-builder__icon" aria-hidden="true"><i data-lucide="' +
              entry.icon +
              '"></i></span><span>' +
              escapeHtml(label) +
              '</span><button type="button" class="feature-builder__remove" data-feature-remove aria-label="Remover ' +
              escapeHtml(label) +
              '">×</button></li>'
            );
          })
          .join("");
        if (window.lucide && typeof window.lucide.createIcons === "function") {
          window.lucide.createIcons({ root: list });
        }
      }
    }

    function sync() {
      output.value = entries.map(serializeEntry).join("\n");
      render();
    }

    function upsertEntry(icon, quantity) {
      if (!icon) return;
      var safeIcon = String(icon).toLowerCase();
      var parsedQuantity = Number.parseInt(quantity, 10);
      var safeQuantity = Number.isFinite(parsedQuantity) && parsedQuantity > 0 ? parsedQuantity : 1;
      var existingIndex = entries.findIndex(function (entry) {
        return !entry.raw && entry.icon === safeIcon;
      });
      if (existingIndex >= 0) {
        entries[existingIndex].quantity = safeQuantity;
      } else {
        entries.push({ icon: safeIcon, quantity: safeQuantity });
      }
    }

    var initialRaw = String(output.value || "");
    if (initialRaw.trim()) {
      initialRaw
        .split(/\r?\n/)
        .map(function (line) {
          return line.trim();
        })
        .filter(Boolean)
        .forEach(function (line) {
          var pipeIndex = line.indexOf("|");
          if (pipeIndex > -1) {
            var icon = line.slice(0, pipeIndex).trim().toLowerCase();
            var label = line.slice(pipeIndex + 1).trim();
            if (presetMap[icon]) {
              var match = label.match(/^(\d+)/);
              var quantity = match ? Number.parseInt(match[1], 10) : 1;
              upsertEntry(icon, quantity);
              return;
            }
          }
          entries.push({ raw: line });
        });
      sync();
    } else {
      render();
    }

    addButton.addEventListener("click", function () {
      var icon = select.value;
      if (!icon) {
        select.focus();
        return;
      }
      var quantity = Number.parseInt(quantityInput.value, 10);
      upsertEntry(icon, quantity);
      sync();
      select.value = "";
      quantityInput.value = "1";
    });

    quantityInput.addEventListener("change", function () {
      var parsed = Number.parseInt(quantityInput.value, 10);
      if (!Number.isFinite(parsed) || parsed < 1) {
        quantityInput.value = "1";
      }
    });

    list.addEventListener("click", function (event) {
      var trigger = event.target.closest("[data-feature-remove]");
      if (!trigger) return;
      var item = trigger.closest("[data-feature-item]");
      if (!item) return;
      var index = Number.parseInt(item.getAttribute("data-index"), 10);
      if (Number.isInteger(index)) {
        entries.splice(index, 1);
        sync();
      }
    });

    root.dataset.featureBuilderReady = "true";
  }

  function initFeatureBuilders() {
    document.querySelectorAll("[data-feature-builder]").forEach(initFeatureBuilder);
  }

  window.__initFeatureBuilders = initFeatureBuilders;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initFeatureBuilders);
  } else {
    initFeatureBuilders();
  }
})();
