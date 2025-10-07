(function () {
  if (typeof window === "undefined") return;
  document.addEventListener("DOMContentLoaded", function () {
    if (typeof window.__initFeatureBuilders === "function") {
      window.__initFeatureBuilders();
    }

    var manager = document.querySelector("[data-gallery-manager]");
    if (!manager) return;

    var list = manager.querySelector("[data-gallery-list]");
    var emptyState = manager.querySelector("[data-gallery-empty]");
    var flash = manager.querySelector("[data-gallery-flash]");
    var unitId = manager.getAttribute("data-unit-id");
    var flashTimer = null;
    var dragItem = null;
    var lastOrderKey = list
      ? JSON.stringify(Array.from(list.querySelectorAll("[data-gallery-tile]")).map(function (el) {
          return el.dataset.imageId;
        }))
      : "[]";

    function showFlash(message, variant) {
      if (!flash) return;
      flash.textContent = message;
      flash.setAttribute("data-variant", variant || "info");
      flash.hidden = false;
      if (flashTimer) window.clearTimeout(flashTimer);
      flashTimer = window.setTimeout(function () {
        flash.hidden = true;
      }, 2600);
    }

    function syncEmpty() {
      if (!list || !emptyState) return;
      var isEmpty = list.querySelectorAll("[data-gallery-tile]").length === 0;
      list.classList.toggle("hidden", isEmpty);
      emptyState.classList.toggle("hidden", !isEmpty);
    }

    function refreshOrderKey() {
      if (!list) {
        lastOrderKey = "[]";
        return;
      }
      lastOrderKey = JSON.stringify(
        Array.from(list.querySelectorAll("[data-gallery-tile]")).map(function (el) {
          return el.dataset.imageId;
        })
      );
    }

    function persistOrder(newOrder) {
      if (!Array.isArray(newOrder) || !newOrder.length) return Promise.resolve();
      if (!unitId) {
        showFlash("Unidade inválida.", "danger");
        return Promise.resolve();
      }
      var reorderUrl = "/admin/units/" + encodeURIComponent(unitId) + "/images/reorder";
      return fetch(reorderUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "fetch"
        },
        body: JSON.stringify({ order: newOrder })
      })
        .then(function (res) {
          if (!res.ok) throw new Error("Falha ao guardar a ordenação");
          return res.json();
        })
        .then(function (data) {
          if (data && data.success) {
            showFlash("Ordem atualizada com sucesso.", "success");
          } else {
            throw new Error("Resposta inválida do servidor");
          }
        })
        .catch(function (err) {
          showFlash(err.message || "Erro ao guardar a ordenação.", "danger");
          refreshOrderKey();
        });
    }

    function handlePrimary(imageId) {
      var button = manager.querySelector('[data-image-id="' + imageId + '"] [data-gallery-action="primary"]');
      if (button) button.disabled = true;
      if (!unitId) {
        showFlash("Unidade inválida.", "danger");
        if (button) button.disabled = false;
        return;
      }
      var encodedImageId = encodeURIComponent(imageId);
      var primaryUrl = "/admin/units/" + encodeURIComponent(unitId) + "/images/" + encodedImageId + "/primary";
      fetch(primaryUrl, {
        method: "POST",
        headers: {
          "X-Requested-With": "fetch"
        }
      })
        .then(function (res) {
          if (!res.ok) throw new Error("Não foi possível atualizar o destaque");
          return res.json();
        })
        .then(function (data) {
          if (!data || !data.success) throw new Error("Resposta inválida do servidor");
          Array.from(manager.querySelectorAll("[data-gallery-tile]")).forEach(function (tile) {
            tile.classList.toggle("is-primary", tile.dataset.imageId === imageId);
            var primaryButton = tile.querySelector('[data-gallery-action="primary"]');
            if (!primaryButton) return;
            if (tile.dataset.imageId === imageId) {
              primaryButton.textContent = "Em destaque";
              primaryButton.disabled = true;
            } else {
              primaryButton.textContent = "Tornar destaque";
              primaryButton.disabled = false;
            }
          });
          showFlash("Imagem destacada atualizada.", "success");
        })
        .catch(function (err) {
          showFlash(err.message || "Falha ao atualizar destaque.", "danger");
          if (button) button.disabled = false;
        });
    }

    function handleDelete(imageId) {
      if (!window.confirm("Remover esta imagem?")) return;
      if (!unitId) {
        showFlash("Unidade inválida.", "danger");
        return;
      }
      var encodedImageId = encodeURIComponent(imageId);
      var deleteUrl = "/admin/units/" + encodeURIComponent(unitId) + "/images/" + encodedImageId + "/delete";
      fetch(deleteUrl, {
        method: "POST",
        headers: {
          "X-Requested-With": "fetch"
        }
      })
        .then(function (res) {
          if (!res.ok) throw new Error("Não foi possível remover a imagem");
          return res.json();
        })
        .then(function (data) {
          if (!data || !data.success) throw new Error("Resposta inválida do servidor");
          var tile = manager.querySelector('[data-gallery-tile][data-image-id="' + imageId + '"]');
          if (tile) tile.remove();
          showFlash("Imagem removida.", "success");
          syncEmpty();
          refreshOrderKey();
        })
        .catch(function (err) {
          showFlash(err.message || "Erro ao remover imagem.", "danger");
        });
    }

    function handleDragStart(event) {
      var tile = event.target.closest("[data-gallery-tile]");
      if (!tile) return;
      dragItem = tile;
      tile.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", tile.dataset.imageId);
    }

    function handleDragOver(event) {
      event.preventDefault();
      if (!dragItem || !list) return;
      var tile = event.target.closest("[data-gallery-tile]");
      if (!tile || tile === dragItem) return;
      var tiles = Array.from(list.querySelectorAll("[data-gallery-tile]"));
      var dragIndex = tiles.indexOf(dragItem);
      var hoverIndex = tiles.indexOf(tile);
      if (dragIndex < hoverIndex) {
        list.insertBefore(tile, dragItem);
      } else {
        list.insertBefore(dragItem, tile);
      }
    }

    function handleDragEnd(event) {
      event.preventDefault();
      if (!dragItem) return;
      dragItem.classList.remove("dragging");
      dragItem = null;
      if (!list) return;
      var newOrder = Array.from(list.querySelectorAll("[data-gallery-tile]")).map(function (tile) {
        return tile.dataset.imageId;
      });
      var newOrderKey = JSON.stringify(newOrder);
      if (newOrderKey === lastOrderKey) return;
      lastOrderKey = newOrderKey;
      persistOrder(newOrder).then(syncEmpty);
    }

    function handleKeydown(event) {
      if (event.key !== "Enter" && event.key !== " ") return;
      var tile = event.target.closest("[data-gallery-tile]");
      if (!tile || !list) return;
      var tiles = Array.from(list.querySelectorAll("[data-gallery-tile]"));
      var currentIndex = tiles.indexOf(tile);
      var direction = event.shiftKey ? -1 : 1;
      var swapIndex = currentIndex + direction;
      if (swapIndex < 0 || swapIndex >= tiles.length) return;
      event.preventDefault();
      var swapTile = tiles[swapIndex];
      if (!swapTile) return;
      if (direction > 0) {
        list.insertBefore(swapTile, tile);
      } else {
        list.insertBefore(tile, swapTile);
      }
      var reordered = Array.from(list.querySelectorAll("[data-gallery-tile]")).map(function (item) {
        return item.dataset.imageId;
      });
      var reorderedKey = JSON.stringify(reordered);
      if (reorderedKey !== lastOrderKey) {
        lastOrderKey = reorderedKey;
        persistOrder(reordered).then(syncEmpty);
      }
    }

    manager.addEventListener("click", function (event) {
      var action = event.target.closest("[data-gallery-action]");
      if (!action) return;
      var tile = action.closest("[data-gallery-tile]");
      if (!tile) return;
      var imageId = tile.dataset.imageId;
      if (!imageId) return;
      var type = action.getAttribute("data-gallery-action");
      if (type === "primary") {
        handlePrimary(imageId);
      } else if (type === "delete") {
        handleDelete(imageId);
      }
    });

    manager.addEventListener("dragstart", handleDragStart);
    manager.addEventListener("dragover", handleDragOver);
    manager.addEventListener("dragend", handleDragEnd);
    manager.addEventListener("keydown", handleKeydown);
    syncEmpty();
  });
})();
