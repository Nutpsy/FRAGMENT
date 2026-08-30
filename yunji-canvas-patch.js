(() => {
  "use strict";

  const prototype = CanvasRenderingContext2D.prototype;
  const nativeFill = prototype.fill;
  const nativeFillRect = prototype.fillRect;
  const nativeFillText = prototype.fillText;

  function normalizedColor(value) {
    return String(value).toLowerCase().replace(/\s+/g, "");
  }

  function grainPattern(context) {
    if (context.__scintillaGrainPattern) return context.__scintillaGrainPattern;
    const grain = document.createElement("canvas");
    grain.width = 96;
    grain.height = 96;
    const grainContext = grain.getContext("2d");
    const image = grainContext.createImageData(grain.width, grain.height);
    let state = 0x3f42ab17;

    for (let index = 0; index < image.data.length; index += 4) {
      state = Math.imul(state ^ state >>> 15, 1 | state);
      state ^= state + Math.imul(state ^ state >>> 7, 61 | state);
      const random = ((state ^ state >>> 14) >>> 0) / 4294967296;
      const light = random > .5 ? 255 : 0;
      image.data[index] = light;
      image.data[index + 1] = light;
      image.data[index + 2] = light;
      image.data[index + 3] = Math.round(5 + Math.abs(random - .5) * 13);
    }

    grainContext.putImageData(image, 0, 0);
    context.__scintillaGrainPattern = context.createPattern(grain, "repeat");
    return context.__scintillaGrainPattern;
  }

  prototype.fill = function patchedFill(...argumentsList) {
    const color = normalizedColor(this.fillStyle);
    if (this.canvas?.id === "art" && color === "rgba(105,105,105,0.2)") return;
    return nativeFill.apply(this, argumentsList);
  };

  prototype.fillText = function patchedFillText(text, ...argumentsList) {
    const isDelayedTitle = this.canvas?.id === "art" && (text === "碎" || text === "屑");
    if (isDelayedTitle) return;
    return nativeFillText.call(this, text, ...argumentsList);
  };

  prototype.fillRect = function patchedFillRect(x, y, width, height) {
    const color = normalizedColor(this.fillStyle);
    const isSceneBackground = this.canvas?.id === "art" && x === 0 && y === 0 && width >= 1400 && height >= 880 && (
      color === "#d8d8d8" || color === "rgb(216,216,216)"
    );

    if (!isSceneBackground) {
      return nativeFillRect.call(this, x, y, width, height);
    }

    const previousFill = this.fillStyle;
    const previousAlpha = this.globalAlpha;
    this.fillStyle = "#e6e6e3";
    nativeFillRect.call(this, x, y, width, height);

    this.fillStyle = grainPattern(this);
    this.globalAlpha = .06;
    nativeFillRect.call(this, x, y, width, height);
    this.globalAlpha = previousAlpha;

    this.save();
    this.globalAlpha = 1;
    this.font = '100 171px "Serif Title", serif';
    this.textAlign = "center";
    this.textBaseline = "middle";
    this.fillStyle = "rgb(0,0,0)";
    nativeFillText.call(this, "碎", 641, 458);
    this.fillStyle = "rgb(255,255,255)";
    nativeFillText.call(this, "屑", 799, 458);
    this.restore();

    this.fillStyle = previousFill;
  };
})();
