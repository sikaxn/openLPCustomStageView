/******************************************************************************
 * LED Banner Caption JS (single- or two-line, auto-scaling, crossfade, stable size)
 ******************************************************************************/

window.bannerFontMax = Infinity;   // global font memory (consistent size)

window.OpenLP = {
  myWebSocket: function () {
    const host = window.location.hostname;
    const websocket_port = 4317;

    window.currentBannerLayer = "A";

    ws = new WebSocket(`ws://${host}:${websocket_port}`);

    ws.onmessage = (event) => {
      const reader = new FileReader();
      reader.onload = () => {
        const info = JSON.parse(reader.result.toString()).results;

        OpenLP.myTwelve = info.twelve;

        // reset global font max when item changes
        if (OpenLP.currentItem != info.item ||
            OpenLP.currentService != info.service) {

          OpenLP.currentItem = info.item;
          OpenLP.currentService = info.service;

          window.bannerFontMax = Infinity;  // RESET FONT SIZE FOR NEW SONG
          OpenLP.loadSlides();
        }
        else if (OpenLP.currentSlide != info.slide) {
          OpenLP.currentSlide = parseInt(info.slide, 10);
          OpenLP.updateBanner();
        }

        OpenLP.loadService();
      };
      reader.readAsText(event.data);
    };
  },

  loadService: function () {
    $.getJSON("/api/v2/service/items", function (data) {
      data.forEach(item => {
        if (item.selected) OpenLP.songTitle = item.title || "";
      });
      OpenLP.updateBanner();
    });
  },

  loadSlides: function () {
    $.getJSON("/api/v2/controller/live-items", function (data) {
      OpenLP.currentSlides = data.slides;
      OpenLP.currentSlide = 0;

      data.slides.forEach((slide, idx) => {
        if (slide["selected"]) OpenLP.currentSlide = idx;
      });

      OpenLP.loadService();
    });
  },

  /***********************************************************************
   * updateBanner() — autoscale + global size memory + perfect crossfade
   ***********************************************************************/
  updateBanner: function () {

    let newHtml = "";

    const slide = OpenLP.currentSlides[OpenLP.currentSlide];

    // Blank logic
    const forceBlank =
      OpenLP.display === "blank" ||
      OpenLP.display === "desktop" ||
      OpenLP.display === "theme" ||
      OpenLP.isBlank === true;

    if (!forceBlank && slide) {

      const rawText = slide.text || "";
      const html = slide.html || "";
      const imgSrc = slide.img || "";

      const hasImage =
        (imgSrc && imgSrc.trim() !== "") ||
        html.includes("<img") ||
        rawText.includes("<img");

      if (!hasImage) {
        const lines = rawText
          .replace(/\r/g, "")
          .split("\n")
          .map(line => line.trim())
          .filter(line => line !== "");

        const clipped = lines.slice(0, 2);
        if (clipped.length > 0) newHtml = clipped.join("<br>");
      }
    }

    // Determine active layer
    const active = (OpenLP.currentBannerLayer === "A")
      ? "#banner-layerA"
      : "#banner-layerB";

    const oldHtml = $(active).html();

    if (oldHtml === newHtml) return;

    // Determine incoming layer (bottom)
    const bottom = (OpenLP.currentBannerLayer === "A") ? "#banner-layerB" : "#banner-layerA";

    // 1. compute raw autoscale size
    let rawSize = OpenLP.fitBannerTextToWidth(newHtml);

    // 2. apply global font memory (stable size across lines)
    let fontSize;
    if (window.bannerFontMax === Infinity) {
      // first line sets baseline
      window.bannerFontMax = rawSize;
      fontSize = rawSize;
    } else {
      // keep consistent appearance
      fontSize = Math.min(rawSize, window.bannerFontMax);
      window.bannerFontMax = fontSize;
    }

    // 3. apply font size ONLY to incoming layer
    $(bottom).css("font-size", fontSize + "px");

    // 4. perform proper crossfade
    OpenLP.swapBannerLayers(newHtml, fontSize);
  },

  /***********************************************************************
   * swapBannerLayers — final version (no resize of outgoing layer)
   ***********************************************************************/
  swapBannerLayers: function(newHtml, fontSize) {
    const isA = OpenLP.currentBannerLayer === "A";
    const top = isA ? "#banner-layerA" : "#banner-layerB";   // outgoing
    const bottom = isA ? "#banner-layerB" : "#banner-layerA"; // incoming

    // 1. prepare incoming layer
    $(bottom).html(newHtml);
    $(bottom).css("opacity", 0);  // reset
    const b = $(bottom)[0];
    void b.offsetHeight;          // force layout BEFORE transition (critical)

    // 2. fade transition
    $(top).css("opacity", 0);
    $(bottom).css("opacity", 1);

    // 3. after fade completes, sync hidden layer WITHOUT flashing
    setTimeout(() => {
      $(top).css("font-size", fontSize + "px");
      $(top).html(newHtml);
      $(top).css("opacity", 0);
    }, 100); // slightly > 0.08s fade duration

    // 4. swap active layer
    OpenLP.currentBannerLayer = isA ? "B" : "A";
  },

  /***********************************************************************
   * Width-based autoscaling — corrected measurement logic
   ***********************************************************************/
  fitBannerTextToWidth: function (text) {
    const measure = $("#text-measure");
    const container = $("#banner-container");

    const styles = getComputedStyle(document.documentElement);
    const maxWidth = container.width();
    const paddingStr = styles.getPropertyValue("--vertical-padding") || "0";
    const padding = parseFloat(paddingStr) || 0;
    const paddingHStr = styles.getPropertyValue("--horizontal-padding") || "0";
    const paddingH = parseFloat(paddingHStr) || 0;
    const availableWidth = Math.max(0, maxWidth - paddingH * 2);
    const maxHeight = container.height() - padding * 2;

    let size = maxHeight; // start from available vertical space
    const minSize = 32;

    measure.css({
      "font-size": size + "px",
      "max-width": availableWidth + "px",
      "white-space": "pre-line",
      "display": "inline-block",
      "text-align": "center"
    });
    measure.html(text || "");

    const box = () => measure[0].getBoundingClientRect();

    while ((box().width > maxWidth || box().height > maxHeight) && size > minSize) {
      size -= 2;
      measure.css("font-size", size + "px");
    }

    return size;
  },

  updateClock: function () {}
};

$(window).on("resize", () => {
  OpenLP.updateBanner();
});

$.ajaxSetup({ cache: false });
OpenLP.myWebSocket();
