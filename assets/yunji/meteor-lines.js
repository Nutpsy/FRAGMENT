(() => {
  "use strict";

  const canvas = document.querySelector("#art");
  const LOGICAL_WIDTH = 1440;
  const LOGICAL_HEIGHT = 900;
  const displayWidth = canvas.getBoundingClientRect().width || LOGICAL_WIDTH;
  const deviceScale = window.devicePixelRatio || 1;
  const renderScale = Math.min(2.5, Math.max(1, displayWidth / LOGICAL_WIDTH * deviceScale));
  canvas.width = Math.round(LOGICAL_WIDTH * renderScale);
  canvas.height = Math.round(LOGICAL_HEIGHT * renderScale);
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.scale(renderScale, renderScale);
  const W = LOGICAL_WIDTH;
  const H = LOGICAL_HEIGHT;

  const FIELD_START = 680;
  const CAPTURE_END = 1250;
  const FIELD_END = 1600;
  const METEOR_CENTER_X = W * .5;
  const METEOR_CENTER_Y = H * .5;
  const METEOR_RADIUS_X = W * .35;
  const METEOR_RADIUS_Y = 348;
  const AI_SOURCE_CENTER_X = 686.83;
  const AI_SOURCE_CENTER_Y = 447.99;
  const AI_SCALE = .46;
  const LANE_Y = [292, 360, 428, 496, 564];
  const DENSE_COUNT = 520;
  const LOOSE_COUNT = 150;
  const EROSION_DURATION = 5;
  const BIG_SIZE_SCALE = .95;
  const MEDIUM_SIZE_SCALE = 1.55;
  const EXTRA_BIG_COUNT = 270;
  const EXTRA_MEDIUM_COUNT = 315;
  const RESERVE_SMALL_COUNT = 260;
  const CORE_LAYER_MULTIPLIER = 3;
  const GENERATION_FULL_END = 8.00;
  const DEPARTURE_RATE = 115;
  const FINAL_DEPARTURE_RATE = 0;
  const FINAL_TAPER_START = GENERATION_FULL_END - 1.2;
  const GENERATION_TAPER_START = GENERATION_FULL_END - 2.0;
  const FINAL_BREAKUP_LEAD = .65;
  const ANIMATION_SPEED = 2.70;
  const SPARKLE_RADIUS_SCALE = 3.2;
  const SPARKLE_SPEED_SCALE = 1.1;
  const TITLE_STYLE = { font: `200 238px "Serif Title", serif`, offset: 110 };

  const particles = [];
  const meteorDots = [];
  const megaGroups = [];
  const structureSlots = [];
  const freeSparkles = [];
  let meteorOutline = null;
  let layoutState = 0x6d2b79f5;
  let time = 0;
  let finalBreakupStarted = false;
  let emissionAccumulator = 0;
  let playing = !new URLSearchParams(window.location.search).has("static");
  let previous = performance.now();

  const random = (min, max) => min + Math.random() * (max - min);
  const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
  const mix = (a, b, amount) => a + (b - a) * amount;

  function resetLayoutRandom() {
    layoutState = 0x6d2b79f5;
  }

  function layoutRandom(min = 0, max = 1) {
    layoutState |= 0;
    layoutState = layoutState + 0x6d2b79f5 | 0;
    let value = Math.imul(layoutState ^ layoutState >>> 15, 1 | layoutState);
    value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
    value = ((value ^ value >>> 14) >>> 0) / 4294967296;
    return min + value * (max - min);
  }

  function buildMeteorOutline() {
    const anchors = [];
    const pointCount = 20;
    for (let index = 0; index < pointCount; index += 1) {
      const angle = index / pointCount * Math.PI * 2;
      const rockNoise = 1
        + Math.sin(angle * 3 + .7) * .055
        + Math.sin(angle * 7 - .35) * .028
        + Math.cos(angle * 11 + .9) * .016;
      anchors.push([
        Math.cos(angle) * METEOR_RADIUS_X * rockNoise,
        Math.sin(angle) * METEOR_RADIUS_Y * rockNoise
      ]);
    }
    return anchors.map((anchor, index) => {
      const previous = anchors[(index - 1 + anchors.length) % anchors.length];
      const next = anchors[(index + 1) % anchors.length];
      const tangentX = (next[0] - previous[0]) * .145;
      const tangentY = (next[1] - previous[1]) * .145;
      return {
        a: anchor,
        l: [anchor[0] - tangentX, anchor[1] - tangentY],
        r: [anchor[0] + tangentX, anchor[1] + tangentY]
      };
    });
  }

  function pointInsideMeteor(x, y, margin = 0) {
    const dx = x - METEOR_CENTER_X;
    const dy = y - METEOR_CENTER_Y;
    const angle = Math.atan2(dy / METEOR_RADIUS_Y, dx / METEOR_RADIUS_X);
    const rockNoise = 1
      + Math.sin(angle * 3 + .7) * .055
      + Math.sin(angle * 7 - .35) * .028
      + Math.cos(angle * 11 + .9) * .016;
    const normalized = Math.hypot(dx / METEOR_RADIUS_X, dy / METEOR_RADIUS_Y);
    return normalized <= rockNoise - margin / Math.min(METEOR_RADIUS_X, METEOR_RADIUS_Y);
  }

  function meteorEdgeScale(x, y) {
    const dx = x - METEOR_CENTER_X;
    const dy = y - METEOR_CENTER_Y;
    const angle = Math.atan2(dy / METEOR_RADIUS_Y, dx / METEOR_RADIUS_X);
    const rockNoise = 1
      + Math.sin(angle * 3 + .7) * .055
      + Math.sin(angle * 7 - .35) * .028
      + Math.cos(angle * 11 + .9) * .016;
    const normalizedRadius = Math.hypot(dx / METEOR_RADIUS_X, dy / METEOR_RADIUS_Y) / rockNoise;
    const edgeAmount = smoothstep(.68, 1, normalizedRadius);
    return mix(1, .38, edgeAmount);
  }

  function generatedRockShape(radius, softness, seed) {
    const sides = 5 + Math.floor(seededUnit(seed + 2.3) * 4);
    const rotation = seededUnit(seed + 5.1) * Math.PI * 2;
    const anchors = Array.from({ length: sides }, (_, index) => {
      const angleJitter = (seededUnit(seed + index * 3.17) - .5) * .34;
      const angle = rotation + (index + angleJitter) / sides * Math.PI * 2;
      const radial = .72 + seededUnit(seed + index * 5.23 + .8) * .34;
      const squash = .82 + seededUnit(seed + 8.4) * .28;
      return [Math.cos(angle) * radius * radial, Math.sin(angle) * radius * radial * squash];
    });
    return anchors.map((anchor, index) => {
      if (softness <= 0) return { a: anchor, l: anchor.slice(), r: anchor.slice() };
      const previous = anchors[(index - 1 + anchors.length) % anchors.length];
      const next = anchors[(index + 1) % anchors.length];
      const tangentX = (next[0] - previous[0]) * softness;
      const tangentY = (next[1] - previous[1]) * softness;
      return {
        a: anchor,
        l: [anchor[0] - tangentX, anchor[1] - tangentY],
        r: [anchor[0] + tangentX, anchor[1] + tangentY]
      };
    });
  }

  function generatedColor(seed, allowBlack = true, whiteShare = .76, grayShare = .20) {
    const roll = seededUnit(seed + 17.4);
    if (roll < whiteShare) return [255, 255, 255];
    if (roll < whiteShare + grayShare || !allowBlack) return [184, 184, 184];
    return [0, 0, 0];
  }

  function particleSpeed(sizeClass) {
    if (sizeClass === "large") return random(850, 1250);
    if (sizeClass === "medium") return random(1650, 2350);
    return random(2440, 2920);
  }

  function sourceSizeClass(sourceDot, radius) {
    if (sourceDot) {
      if (sourceDot.sourceLayer.indexOf("剥落") >= 0 || sourceDot.sourceLayer.indexOf("内核") === 0) return "large";
      if (sourceDot.sourceLayer.indexOf("中尺寸") >= 0) return "medium";
      return "small";
    }
    return radius > 3.2 ? "medium" : "small";
  }

  function smoothstep(a, b, value) {
    const t = clamp((value - a) / (b - a));
    return t * t * (3 - 2 * t);
  }

  function nearestLane(y) {
    let nearest = 0;
    let distance = Infinity;
    LANE_Y.forEach((laneY, index) => {
      const nextDistance = Math.abs(laneY - y);
      if (nextDistance < distance) {
        nearest = index;
        distance = nextDistance;
      }
    });
    if (Math.random() < .18) nearest = clamp(nearest + (Math.random() < .5 ? -1 : 1), 0, LANE_Y.length - 1);
    return nearest;
  }

  function colorForParticle(dense) {
    const roll = Math.random();
    if (roll < (dense ? .76 : .58)) return [255, 255, 255];
    if (roll < .93) return [205, 205, 205];
    return [45, 45, 45];
  }

  function randomMeteorPosition() {
    const source = meteorDots[Math.floor(Math.random() * meteorDots.length)];
    if (source) {
      return {
        x: source.x + random(-source.radius * .32, source.radius * .32),
        y: source.y + random(-source.radius * .32, source.radius * .32)
      };
    }
    return {
      x: METEOR_CENTER_X,
      y: METEOR_CENTER_Y
    };
  }

  function aiRenderLayer(layerName) {
    if (layerName.indexOf("内核") === 0) return 0;
    if (layerName.indexOf("小尺寸") >= 0) return 1;
    if (layerName.indexOf("中层") >= 0) return 2;
    if (layerName.indexOf("中尺寸") >= 0) return 3;
    return 4;
  }

  function aiSurfaceLife(layerName) {
    if (layerName.indexOf("小尺寸") >= 0) return random(.08, 3.60);
    if (layerName.indexOf("中尺寸") >= 0) return random(.35, 4.25);
    if (layerName.indexOf("外层") >= 0) return random(1.50, 3.45);
    if (layerName.indexOf("中层") >= 0) return random(2.50, 4.55);
    return Infinity;
  }

  function aiItemScale(layerName) {
    if (layerName.indexOf("中尺寸") >= 0) return AI_SCALE * MEDIUM_SIZE_SCALE;
    if (layerName.indexOf("剥落") >= 0 || layerName.indexOf("内核") === 0) return AI_SCALE * BIG_SIZE_SCALE;
    return AI_SCALE;
  }

  function seededUnit(seed) {
    return Math.abs(Math.sin(seed * 12.9898 + 78.233) * 43758.5453) % 1;
  }

  function meteorItemShape(item, itemScale) {
    const isStraightQuad = item.points.length === 4 && item.points.every(point =>
      point.a[0] === point.l[0] && point.a[1] === point.l[1] &&
      point.a[0] === point.r[0] && point.a[1] === point.r[1]
    );
    if (!isStraightQuad) {
      return item.points.map(point => ({
        a: [point.a[0] * itemScale, point.a[1] * itemScale],
        l: [point.l[0] * itemScale, point.l[1] * itemScale],
        r: [point.r[0] * itemScale, point.r[1] * itemScale]
      }));
    }

    const seed = item.x * .173 + item.y * .317 + item.width * .619;
    const sideCount = 4 + Math.floor(seededUnit(seed) * 3);
    const radiusX = item.width * itemScale * .5;
    const radiusY = item.height * itemScale * .5;
    const rotation = seededUnit(seed + 4.2) * Math.PI * 2;
    return Array.from({ length: sideCount }, (_, index) => {
      const angleJitter = (seededUnit(seed + index * 4.13 + 1.9) - .5) * .42;
      const angle = rotation + (index + angleJitter) / sideCount * Math.PI * 2;
      const radial = .62 + seededUnit(seed + index * 2.71) * .50;
      const point = [Math.cos(angle) * radiusX * radial, Math.sin(angle) * radiusY * radial];
      return { a: point, l: point, r: point };
    });
  }

  function meteorItemColor(item, layerName, positionItem) {
    const isBlack = item.color[0] === 0 && item.color[1] === 0 && item.color[2] === 0;
    if (!isBlack) return item.color;
    const seed = item.x * .113 + item.y * .271 + positionItem.x * .397 + positionItem.y * .179 + layerName.length;
    if (seededUnit(seed) < .34) return item.color;
    return seededUnit(seed + 9.7) < .72 ? [255, 255, 255] : [184, 184, 184];
  }

  function createMeteorItem(item, layerName, positionItem = item, isClone = false) {
    const itemScale = aiItemScale(layerName);
    return {
      x: METEOR_CENTER_X + (positionItem.x - AI_SOURCE_CENTER_X) * AI_SCALE,
      y: METEOR_CENTER_Y + (positionItem.y - AI_SOURCE_CENTER_Y) * AI_SCALE,
      radius: Math.max(item.width, item.height) * itemScale * .5,
      renderLayer: aiRenderLayer(layerName),
      phase: random(0, Math.PI * 2),
      motionAmplitude: Math.max(item.width, item.height) > 48 ? random(.12, .38) : random(.22, .68),
      motionRate: random(.75, 1.45),
      color: meteorItemColor(item, layerName, positionItem),
      alpha: item.opacity / 100,
      shape: meteorItemShape(item, itemScale),
      sourceLayer: layerName,
      groupPath: item.groupPath,
      isClone,
      megaGroup: null,
      visible: true,
      surfaceLife: aiSurfaceLife(layerName)
    };
  }

  function meteorDotPosition(dot) {
    const fastX = Math.sin(time * dot.motionRate + dot.phase) * dot.motionAmplitude;
    const fastY = Math.cos(time * (dot.motionRate * .83) + dot.phase * 1.27) * dot.motionAmplitude * .72;
    const slowX = Math.sin(time * .47 + dot.phase * 2.1) * .32;
    const slowY = Math.cos(time * .39 + dot.phase * 1.6) * .28;
    const groupOffsetX = dot.megaGroup ? dot.megaGroup.offsetX : 0;
    const groupOffsetY = dot.megaGroup ? dot.megaGroup.offsetY : 0;
    const finalOffsetX = dot.finalOffsetX || 0;
    const finalOffsetY = dot.finalOffsetY || 0;
    return {
      x: dot.x + groupOffsetX + finalOffsetX + fastX + slowX,
      y: dot.y + groupOffsetY + finalOffsetY + fastY + slowY
    };
  }

  function claimMeteorDot() {
    const isReady = dot => dot.visible && dot.surfaceLife <= 0;
    const release = dot => {
      if (!dot) return null;
      const releasePosition = meteorDotPosition(dot);
      dot.visible = false;
      if (dot.slot) dot.slot.occupied = false;
      dot.slot = null;
      dot.releaseX = releasePosition.x;
      dot.releaseY = releasePosition.y;
      dot.respawnAt = time + respawnDelayAt(time);
      return dot;
    };

    if (time >= GENERATION_FULL_END) {
      const readyDots = meteorDots.filter(isReady);
      if (readyDots.length === 0) return null;
      const finalScore = dot => {
        const nx = (dot.x - METEOR_CENTER_X) / METEOR_RADIUS_X;
        const ny = (dot.y - METEOR_CENTER_Y) / METEOR_RADIUS_Y;
        const edge = Math.hypot(nx, ny);
        const size = clamp(dot.radius / 58);
        const jitter = (seededUnit(dot.x * .193 + dot.y * .317 + dot.phase * 2.71) - .5) * .22;
        return edge * .74 + size * .86 + nx * .14 + jitter;
      };
      return release(readyDots.reduce((best, dot) => finalScore(dot) > finalScore(best) ? dot : best));
    }

    for (let attempt = 0; attempt < 80; attempt += 1) {
      const dot = meteorDots[Math.floor(Math.random() * meteorDots.length)];
      if (isReady(dot)) return release(dot);
    }
    return release(meteorDots.find(isReady));
  }

  function createParticle(dense = true, initial = false) {
    const initialPosition = initial ? randomMeteorPosition() : null;
    const sourceDot = initial ? null : claimMeteorDot();
    if (!initial && !sourceDot) return null;
    const sourceY = initialPosition ? initialPosition.y : sourceDot.releaseY;
    const lane = nearestLane(sourceY);
    const x = initialPosition ? initialPosition.x : sourceDot.releaseX;
    const y = sourceY;
    const color = sourceDot ? sourceDot.color : colorForParticle(dense);
    const sizeRoll = Math.random();
    const radius = sourceDot ? sourceDot.radius : sizeRoll < .76 ? random(1.15, 2.8) : sizeRoll < .96 ? random(2.2, 3.9) : random(4.0, 6.3);
    const sizeClass = sourceSizeClass(sourceDot, radius);
    const visualShape = sourceDot
      ? sourceDot.visualShape
      : sizeClass === "small" && Math.random() < .18 ? "star4" : "square";
    const speed = particleSpeed(sizeClass);
    const finalErosion = !initial && time >= FINAL_TAPER_START;
    const inheritedGroup = sourceDot && sourceDot.megaGroup && sourceDot.megaGroup.state === "moving"
      ? sourceDot.megaGroup
      : null;
    const laneSpread = sizeClass === "large" ? 58 : sizeClass === "medium" ? 38 : 24;
    return {
      dense,
      active: true,
      sizeClass,
      renderLayer: initial ? 1 : sourceDot.renderLayer,
      outsideMeteor: !!(sourceDot && sourceDot.megaGroup),
      lane,
      laneOffset: random(-laneSpread, laneSpread),
      fieldAffinity: dense ? random(.32, .90) : random(.08, .42),
      fieldReleaseDelay: 0,
      wanderAmplitude: dense ? random(7, 22) : random(18, 48),
      wanderPhase: random(0, Math.PI * 2),
      x,
      y,
      previousX: x,
      previousY: y,
      vx: inheritedGroup
        ? inheritedGroup.currentVx
        : speed * (sizeClass === "small" ? random(.90, .98) : random(.72, .90)),
      targetVx: speed,
      vy: inheritedGroup ? inheritedGroup.currentVy : random(-60, 60),
      radius,
      shape: sourceDot ? sourceDot.shape : null,
      visualShape,
      color,
      alpha: 1,
      noisePhase: random(0, Math.PI * 2),
      noiseRate: random(.7, 1.8),
      speedPhase: random(0, Math.PI * 2),
      speedRate: random(.26, .58),
      speedVariance: sizeClass === "large" ? random(.05, .09) : sizeClass === "medium" ? random(.07, .12) : random(.09, .15),
      dragLength: dense ? random(.55, 1.15) : random(.25, .72),
      holdTime: initial ? random(.05, 1.25) : inheritedGroup ? 0 : finalErosion ? random(.01, .055) : random(.05, .18),
      holdX: x,
      holdY: y,
      age: 0,
      splitAfter: sizeClass === "large" || sizeClass === "medium" ? 0 : Infinity,
      fragmentDrift: 0,
      fragmentDriftX: 0,
      separationDelay: 0,
      speedDelay: 0,
      splitting: false,
      shrinking: false,
      finalErosion,
      birthDuration: 0
    };
  }

  function launchReadySurfaceDots(limit = 36) {
    let launchedCount = 0;
    for (let index = 0; index < limit; index += 1) {
      let slot = particles.find(particle => !particle.active);
      if (!slot && particles.length >= 3800) return launchedCount;
      const launched = createParticle(true, false);
      if (!launched) return launchedCount;
      if (slot) Object.assign(slot, launched);
      else particles.push(launched);
      launchedCount += 1;
    }
    return launchedCount;
  }

  function resetParticle(particle, dense = particle.dense) {
    particle.active = false;
  }

  function createReserveSmall() {
    const particle = createParticle(true, true);
    const speed = particleSpeed("small");
    particle.reserveSmall = true;
    particle.sizeClass = "small";
    particle.radius = random(1.25, 2.8);
    particle.shape = null;
    particle.visualShape = "square";
    particle.color = colorForParticle(true);
    particle.alpha = 1;
    particle.vx = speed * random(.90, .98);
    particle.targetVx = speed;
    particle.splitAfter = Infinity;
    particle.holdTime = random(0, 3.8);
    return particle;
  }

  function cubicPoint(p0, p1, p2, p3, t) {
    const inverse = 1 - t;
    const a = inverse * inverse * inverse;
    const b = 3 * inverse * inverse * t;
    const c = 3 * inverse * t * t;
    const d = t * t * t;
    return [
      p0[0] * a + p1[0] * b + p2[0] * c + p3[0] * d,
      p0[1] * a + p1[1] * b + p2[1] * c + p3[1] * d
    ];
  }

  function particleBoundary(parent) {
    if (!parent.shape || parent.shape.length < 2) {
      return Array.from({ length: 36 }, (_, index) => {
        const angle = index / 36 * Math.PI * 2;
        return [Math.cos(angle) * parent.radius, Math.sin(angle) * parent.radius];
      });
    }

    const boundary = [];
    const samplesPerSegment = 8;
    for (let index = 0; index < parent.shape.length; index += 1) {
      const current = parent.shape[index];
      const next = parent.shape[(index + 1) % parent.shape.length];
      for (let sample = 0; sample < samplesPerSegment; sample += 1) {
        boundary.push(cubicPoint(current.a, current.r, next.l, next.a, sample / samplesPerSegment));
      }
    }
    return boundary;
  }

  function fractureShape(parent, count) {
    const boundary = particleBoundary(parent);
    const center = boundary.reduce((sum, point) => [sum[0] + point[0], sum[1] + point[1]], [0, 0]);
    center[0] /= boundary.length;
    center[1] /= boundary.length;

    return Array.from({ length: count }, (_, fragmentIndex) => {
      const start = Math.floor(fragmentIndex * boundary.length / count);
      const end = Math.floor((fragmentIndex + 1) * boundary.length / count);
      const polygon = [center.slice()];
      for (let cursor = start; cursor <= end; cursor += 1) polygon.push(boundary[cursor % boundary.length].slice());

      const localCenter = polygon.reduce((sum, point) => [sum[0] + point[0], sum[1] + point[1]], [0, 0]);
      localCenter[0] /= polygon.length;
      localCenter[1] /= polygon.length;
      const shape = polygon.map(point => {
        const anchor = [point[0] - localCenter[0], point[1] - localCenter[1]];
        return { a: anchor, l: anchor.slice(), r: anchor.slice() };
      });
      const radius = shape.reduce((maximum, point) => Math.max(maximum, Math.hypot(point.a[0], point.a[1])), 0);
      return { shape, radius, offsetX: localCenter[0], offsetY: localCenter[1] };
    });
  }

  function activateFragment(parent, sizeClass, index, count, fragment, fractureAngle) {
    let slot = particles.find(particle => !particle.active);
    if (!slot) {
      if (particles.length >= 2600) return;
      slot = {};
      particles.push(slot);
    }

    const side = count === 2 ? index - .5 : index - (count - 1) * .5;
    const fan = fractureAngle + side * random(.08, .15) + random(-.025, .025);
    const x = parent.x + fragment.offsetX;
    const y = parent.y + fragment.offsetY;
    const speed = particleSpeed(sizeClass);
    const lane = parent.lane;
    Object.assign(slot, {
      dense: sizeClass === "small" ? true : parent.dense,
      active: true,
      sizeClass,
      renderLayer: 4,
      outsideMeteor: true,
      lane,
      laneOffset: parent.laneOffset + random(-16, 16),
      fieldAffinity: clamp(parent.fieldAffinity * random(.72, 1.08), .10, .92),
      wanderAmplitude: parent.wanderAmplitude * random(.82, 1.28),
      wanderPhase: random(0, Math.PI * 2),
      x,
      y,
      previousX: x,
      previousY: y,
      vx: parent.vx * random(.985, 1.012),
      targetVx: speed,
      vy: parent.vy,
      radius: fragment.radius,
      shape: fragment.shape,
      visualShape: "square",
      color: parent.color,
      alpha: 1,
      noisePhase: random(0, Math.PI * 2),
      noiseRate: random(.8, 2.0),
      speedPhase: random(0, Math.PI * 2),
      speedRate: random(.30, .66),
      speedVariance: sizeClass === "medium" ? random(.08, .13) : random(.10, .16),
      dragLength: sizeClass === "small" ? random(.65, 1.22) : random(.42, .88),
      holdTime: 0,
      holdX: x,
      holdY: y,
      age: 0,
      splitAfter: sizeClass === "medium" ? 0 : Infinity,
      fragmentDrift: Math.sin(fan) * (Math.abs(side) + .35) * random(13, 25),
      fragmentDriftX: Math.abs(Math.cos(fan)) * (Math.abs(side) + .35) * random(16, 30),
      separationDelay: random(.18, .34),
      speedDelay: random(.34, .62),
      splitting: false,
      shrinking: false,
      birthDuration: 0
    });
  }

  function splitParticle(particle) {
    const targetClass = particle.sizeClass === "large" ? "medium" : "small";
    const count = Math.random() < .62 ? 3 : 4;
    const fragments = fractureShape(particle, count);
    const fractureAngle = random(-Math.PI * .24, Math.PI * .24);
    for (let index = 0; index < count; index += 1) {
      activateFragment(particle, targetClass, index, count, fragments[index], fractureAngle);
    }
    particle.active = false;
  }

  function beginShrink(particle) {
    particle.shrinking = true;
    particle.shrinkStartedAt = particle.age;
    particle.shrinkStartRadius = particle.radius;
    particle.shrinkTargetRadius = random(.75, 1.7);
    const remainingDistance = Math.max(180, FIELD_END - particle.x);
    const travelSpeed = Math.max(420, mix(particle.vx, particleSpeed("small"), .58));
    const travelDuration = remainingDistance / travelSpeed;
    particle.shrinkDuration = particle.sizeClass === "large"
      ? clamp(travelDuration * random(.82, .96), .72, 1.55)
      : clamp(travelDuration * random(.72, .90), .42, 1.05);
    if (particle.finalErosion) particle.shrinkDuration *= .64;
    particle.shrinkStartTargetVx = particle.targetVx;
    particle.shrinkEndTargetVx = particleSpeed("small");
    particle.splitAfter = Infinity;
  }

  function buildMegaGroups() {
    megaGroups.length = 0;
    const definitions = [[], [], [], [], []];
    // The whole particle body is divided into five adjacent final regions.
    // There is no longer a separately timed visual "bottom layer".
    const coreDots = meteorDots.filter(dot => !dot.isClone);

    for (const dot of coreDots) {
      const groupName = dot.groupPath[dot.groupPath.length - 1] || "";
      const match = groupName.match(/_(\d+)$/);
      const originalIndex = match ? parseInt(match[1], 10) : 1;
      const megaIndex = originalIndex === 1 || originalIndex === 6 ? 0 : originalIndex - 1;
      definitions[megaIndex].push(dot);
    }

    // Keep the five connected regions visibly different in speed. A narrow
    // random range still reads as one slab moving sideways.
    const groupSpeeds = [760, 1260, 930, 1480, 1080];
    const groupLaunchOffsets = [.02, .42, .16, .56, .29];
    definitions.forEach((dots, index) => {
      if (dots.length === 0) return;
      const centerX = dots.reduce((sum, dot) => sum + dot.x, 0) / dots.length;
      const centerY = dots.reduce((sum, dot) => sum + dot.y, 0) / dots.length;
      const group = {
        id: index,
        dots,
        centerX,
        centerY,
        state: "waiting",
        age: 0,
        offsetX: 0,
        offsetY: 0,
        launchedAt: Infinity,
        currentVx: groupSpeeds[index] * random(.76, .88),
        currentVy: 0,
        vx: groupSpeeds[index] * random(.96, 1.04),
        vy: (centerY - METEOR_CENTER_Y) * .08 + random(-8, 8),
        launchAt: Math.max(0, groupLaunchOffsets[index] + random(-.025, .025)),
        rigidDistance: 275 + random(-35, 45)
      };
      dots.forEach(dot => { dot.megaGroup = group; });
      megaGroups.push(group);
    });
  }

  function createBoundBreakupParticle(dot, group) {
    const position = meteorDotPosition(dot);
    const speed = particleSpeed("large");
    return {
      dense: true,
      active: true,
      sizeClass: "large",
      renderLayer: dot.renderLayer,
      outsideMeteor: true,
      lane: nearestLane(position.y),
      laneOffset: random(-58, 58),
      fieldAffinity: random(.32, .90),
      fieldReleaseDelay: 0,
      wanderAmplitude: random(7, 22),
      wanderPhase: random(0, Math.PI * 2),
      x: position.x,
      y: position.y,
      previousX: position.x,
      previousY: position.y,
      vx: speed * random(.72, .90),
      targetVx: speed,
      vy: random(-60, 60),
      radius: dot.radius,
      shape: null,
      visualShape: "square",
      color: dot.color,
      alpha: 1,
      noisePhase: dot.phase,
      noiseRate: random(.75, 1.35),
      speedPhase: random(0, Math.PI * 2),
      speedRate: random(.26, .58),
      speedVariance: random(.05, .09),
      dragLength: random(.55, 1.15),
      // A whole adjacent region is released together. After this short hold,
      // every block uses exactly the same motion law as earlier erosion.
      holdTime: group.launchAt,
      holdX: position.x,
      holdY: position.y,
      age: 0,
      splitAfter: 0,
      fragmentDrift: 0,
      fragmentDriftX: 0,
      separationDelay: 0,
      speedDelay: 0,
      splitting: false,
      shrinking: false,
      finalErosion: true,
      birthDuration: 0,
      finalBound: false,
      fastFinalShrink: false,
      shrinkOnGroupLaunch: false
    };
  }

  function startFinalBreakup() {
    if (finalBreakupStarted) return;
    finalBreakupStarted = true;

    particles.forEach(particle => {
      if (particle.active && particle.holdTime > 0) particle.active = false;
    });

    megaGroups.forEach(group => {
      group.state = "queued";
      group.age = 0;
      group.offsetX = 0;
      group.offsetY = 0;
      group.launchedAt = Infinity;
      group.currentVx = group.vx * random(.76, .88);
      group.currentVy = group.vy * .55;
    });

    meteorDots.forEach(dot => { dot.visible = false; });
    megaGroups.forEach(group => {
      group.dots.forEach(dot => {
        if (dot.renderLayer > 1) return;
        const breakupParticle = createBoundBreakupParticle(dot, group);
        const slot = particles.find(particle => !particle.active);
        if (slot) Object.assign(slot, breakupParticle);
        else particles.push(breakupParticle);
      });
    });
  }

  function updateFinalBreakup(delta) {
    if (!finalBreakupStarted && time >= GENERATION_FULL_END - FINAL_BREAKUP_LEAD) startFinalBreakup();
  }

  function surfaceDwellAt() {
    return random(.08, .42);
  }

  function respawnDelayAt(now) {
    const generationFactor = 1 - smoothstep(GENERATION_TAPER_START, GENERATION_FULL_END, now);
    if (generationFactor <= .02) return Infinity;
    return random(.06, .20) / Math.max(.08, generationFactor);
  }

  function nearestCoreRegion(x, y) {
    const nx = (x - METEOR_CENTER_X) / METEOR_RADIUS_X;
    const ny = (y - METEOR_CENTER_Y) / METEOR_RADIUS_Y;
    const regions = [
      [-.48, .02],
      [-.06, -.46],
      [0, 0],
      [.48, -.01],
      [.04, .46]
    ];
    let nearest = 0;
    let nearestDistance = Infinity;
    regions.forEach((region, index) => {
      const dx = nx - region[0];
      const dy = ny - region[1];
      const distance = dx * dx + dy * dy;
      if (distance < nearestDistance) {
        nearest = index;
        nearestDistance = distance;
      }
    });
    return nearest + 1;
  }

  function createGeneratedMeteorDot(x, y, radius, config, index) {
    const seed = x * .137 + y * .283 + radius * .719 + index * 1.91 + config.seedOffset;
    const groupIndex = nearestCoreRegion(x, y);
    const scaledRadius = radius * meteorEdgeScale(x, y);
    return {
      x,
      y,
      radius: scaledRadius,
      baseRadius: radius,
      visualShape: "square",
      renderLayer: config.renderLayer,
      phase: layoutRandom(0, Math.PI * 2),
      motionAmplitude: radius > 18 ? layoutRandom(.12, .34) : layoutRandom(.20, .58),
      motionRate: layoutRandom(.75, 1.45),
      color: generatedColor(seed, config.allowBlack, config.whiteShare, config.grayShare),
      alpha: 1,
      shape: config.circular ? null : generatedRockShape(scaledRadius, config.softness, seed),
      sourceLayer: config.sourceLayer,
      groupPath: ["generated-body", `主体最终分组_0${groupIndex}`],
      isClone: false,
      megaGroup: null,
      visible: true,
      surfaceLife: layoutRandom(.04, .82),
      respawnAt: Infinity
    };
  }

  function structureBandSpan(y) {
    const step = 2;
    let left = METEOR_CENTER_X;
    let right = METEOR_CENTER_X;
    for (let x = METEOR_CENTER_X - METEOR_RADIUS_X * 1.12; x <= METEOR_CENTER_X; x += step) {
      if (pointInsideMeteor(x, y)) {
        left = x;
        break;
      }
    }
    for (let x = METEOR_CENTER_X + METEOR_RADIUS_X * 1.12; x >= METEOR_CENTER_X; x -= step) {
      if (pointInsideMeteor(x, y)) {
        right = x;
        break;
      }
    }
    return { left, right, width: Math.max(0, right - left) };
  }

  function assignRandomStructureSlot(dot) {
    const candidates = structureSlots.filter(slot =>
      !slot.occupied && slot.renderLayer === dot.renderLayer &&
      Math.hypot(slot.x - dot.x, slot.y - dot.y) > Math.max(24, dot.radius * 1.35)
    );
    const fallback = candidates.length
      ? candidates
      : structureSlots.filter(slot => !slot.occupied && slot.renderLayer === dot.renderLayer);
    if (fallback.length === 0) return;

    let chosen = fallback[Math.floor(Math.random() * fallback.length)];
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const candidate = fallback[Math.floor(Math.random() * fallback.length)];
      const crowded = meteorDots.some(other =>
        other !== dot && other.visible &&
        Math.hypot(candidate.x - other.x, candidate.y - other.y) < (dot.radius + other.radius) * .30
      );
      if (!crowded) {
        chosen = candidate;
        break;
      }
    }
    chosen.occupied = true;
    dot.slot = chosen;
    dot.x = chosen.x;
    dot.y = chosen.y;
    dot.radius = dot.baseRadius * meteorEdgeScale(dot.x, dot.y);
    dot.phase = random(0, Math.PI * 2);
  }

  function allocateBandQuotas(count, bands) {
    const totalWeight = bands.reduce((sum, band) => sum + band.weight, 0);
    const exact = bands.map(band => count * band.weight / totalWeight);
    const quotas = exact.map(value => Math.floor(value));
    let remainder = count - quotas.reduce((sum, value) => sum + value, 0);
    exact
      .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
      .sort((a, b) => b.fraction - a.fraction)
      .forEach(item => {
        if (remainder <= 0) return;
        quotas[item.index] += 1;
        remainder -= 1;
      });
    return quotas;
  }

  function addGeneratedLayer(config) {
    const bands = Array.from({ length: config.bands }, (_, bandIndex) => {
      const normalizedY = mix(-.88, .88, (bandIndex + .5) / config.bands);
      const y = METEOR_CENTER_Y + normalizedY * METEOR_RADIUS_Y;
      const span = structureBandSpan(y);
      const belly = 1 + (1 - Math.abs(normalizedY)) * config.bellyBoost;
      return { bandIndex, normalizedY, y, span, weight: Math.max(1, span.width) * belly };
    });
    const quotas = allocateBandQuotas(config.count, bands);
    let generatedIndex = 0;

    bands.forEach((band, bandIndex) => {
      const quota = quotas[bandIndex];
      if (quota <= 0 || band.span.width <= 0) return;
      const bandPhase = (bandIndex * .61803398875 + config.seedOffset * .0137) % 1;
      const cellWidth = band.span.width / quota;

      for (let slot = 0; slot < quota; slot += 1) {
        const slotShift = (bandPhase - .5) * .48;
        const u = clamp((slot + .5 + slotShift) / quota, .025, .975);
        const radius = layoutRandom(config.radius[0], config.radius[1]);
        const curve = Math.sin(u * Math.PI * 2 + bandPhase * Math.PI * 2) * config.curve;
        let x = mix(band.span.left, band.span.right, u)
          + layoutRandom(-cellWidth * config.horizontalJitter, cellWidth * config.horizontalJitter);
        let y = band.y + curve + layoutRandom(-config.verticalJitter, config.verticalJitter);

        // Pull only edge violations inward; interior positions retain their designed rhythm.
        for (let attempt = 0; attempt < 12 && !pointInsideMeteor(x, y, config.edgeMargin * radius); attempt += 1) {
          x = mix(x, METEOR_CENTER_X, .13);
          y = mix(y, band.y, .18);
        }
        if (!pointInsideMeteor(x, y, config.edgeMargin * radius)) continue;
        const dot = createGeneratedMeteorDot(x, y, radius, config, generatedIndex);
        const structureSlot = { x, y, renderLayer: config.renderLayer, occupied: true };
        dot.slot = structureSlot;
        structureSlots.push(structureSlot);
        meteorDots.push(dot);
        generatedIndex += 1;
      }
    });

    // Extra unoccupied slots preserve the designed bands while allowing each
    // respawn to appear at a genuinely different surface position.
    const alternateTarget = config.count * 2;
    let alternateCount = 0;
    let attempts = 0;
    while (alternateCount < alternateTarget && attempts < alternateTarget * 30) {
      attempts += 1;
      const band = bands[Math.floor(layoutRandom(0, bands.length))];
      if (!band || band.span.width <= 0) continue;
      const phase = (band.bandIndex * .61803398875 + config.seedOffset * .0137) % 1;
      const u = layoutRandom(.035, .965);
      const x = mix(band.span.left, band.span.right, u);
      const y = band.y + Math.sin(u * Math.PI * 2 + phase * Math.PI * 2) * config.curve
        + layoutRandom(-config.verticalJitter, config.verticalJitter);
      if (!pointInsideMeteor(x, y, config.edgeMargin * config.radius[1])) continue;
      structureSlots.push({ x, y, renderLayer: config.renderLayer, occupied: false });
      alternateCount += 1;
    }
  }

  function applyBlackShare(share) {
    meteorDots.forEach(dot => {
      if (dot.color[0] === 0 && dot.color[1] === 0 && dot.color[2] === 0) {
        dot.color = [255, 255, 255];
      }
    });
    const targetCount = Math.round(meteorDots.length * share);
    const ranked = meteorDots
      .map(dot => ({ dot, rank: seededUnit(dot.x * .193 + dot.y * .317 + dot.phase * 2.71) }))
      .sort((a, b) => a.rank - b.rank);
    const selected = [];
    const selectWithSpacing = spacingScale => {
      ranked.forEach(item => {
        if (selected.length >= targetCount || selected.includes(item.dot)) return;
        const separated = selected.every(other =>
          Math.hypot(item.dot.x - other.x, item.dot.y - other.y) >
          Math.max(34, (item.dot.radius + other.radius) * spacingScale)
        );
        if (separated) selected.push(item.dot);
      });
    };
    selectWithSpacing(.82);
    selectWithSpacing(.48);
    ranked.forEach(item => {
      if (selected.length < targetCount && !selected.includes(item.dot)) selected.push(item.dot);
    });
    selected.forEach(dot => { dot.color = [0, 0, 0]; });
  }

  function seedField() {
    meteorDots.length = 0;
    structureSlots.length = 0;
    resetLayoutRandom();
    finalBreakupStarted = false;
    meteorOutline = { x: METEOR_CENTER_X, y: METEOR_CENTER_Y, shape: buildMeteorOutline() };

    addGeneratedLayer({
      count: 30, radius: [58, 68], edgeMargin: .20,
      renderLayer: 0, sourceLayer: "内核_生成五组", core: true,
      allowBlack: false, whiteShare: .80, grayShare: .20, softness: .075, seedOffset: 10,
      circular: true, bands: 7, bellyBoost: .24, curve: 10, horizontalJitter: .10, verticalJitter: 3.2
    });
    addGeneratedLayer({
      count: 46, radius: [38, 46], edgeMargin: .10,
      renderLayer: 1, sourceLayer: "剥落_中层大尺寸", core: false,
      allowBlack: false, whiteShare: .80, grayShare: .20, softness: .065, seedOffset: 30,
      circular: true, bands: 9, bellyBoost: .30, curve: 8, horizontalJitter: .13, verticalJitter: 3.6
    });
    addGeneratedLayer({
      count: 72, radius: [23, 30], edgeMargin: .025,
      renderLayer: 2, sourceLayer: "中尺寸_生成表层", core: false,
      allowBlack: false, whiteShare: .80, grayShare: .20, softness: .085, seedOffset: 50,
      circular: true, bands: 12, bellyBoost: .34, curve: 6, horizontalJitter: .17, verticalJitter: 3.8
    });
    addGeneratedLayer({
      count: 110, radius: [11, 17], edgeMargin: 0,
      renderLayer: 4, sourceLayer: "小尺寸_生成表层", core: false,
      allowBlack: false, whiteShare: .80, grayShare: .20, softness: .11, seedOffset: 70,
      circular: true, bands: 17, bellyBoost: .42, curve: 4.5, horizontalJitter: .22, verticalJitter: 3.4
    });

    applyBlackShare(.10);
    seedFreeSparkles();

    buildMegaGroups();
    emissionAccumulator = 0;
    particles.length = 0;
    for (let index = 0; index < DENSE_COUNT; index += 1) particles.push(createParticle(true, true));
    for (let index = 0; index < LOOSE_COUNT; index += 1) particles.push(createParticle(false, true));
    for (let index = 0; index < RESERVE_SMALL_COUNT; index += 1) particles.push(createReserveSmall());
  }

  function updateParticle(particle, delta) {
    if (!particle.active) return;
    particle.previousX = particle.x;
    particle.previousY = particle.y;

    if (particle.holdTime > 0) {
      particle.holdTime -= delta;
      particle.x = particle.holdX + Math.sin(time * 9.2 + particle.noisePhase) * 1.8;
      particle.y = particle.holdY + Math.cos(time * 7.7 + particle.noisePhase * 1.3) * 1.5;
      particle.previousX = particle.x;
      particle.previousY = particle.y;
      return;
    }

    particle.age += delta;

    if (
      particle.finalBound &&
      particle.shrinkOnGroupLaunch &&
      particle.finalGroup.state !== "queued"
    ) {
      particle.shrinkOnGroupLaunch = false;
      beginShrink(particle);
      // Final groups cross the viewport very quickly. Complete most of their
      // size loss while they are still visible instead of after they exit.
      particle.shrinkDuration = random(.34, .50);
      particle.shrinkEndTargetVx *= particle.finalSpeedMultiplier;
    }

    if (!particle.shrinking && particle.age >= particle.splitAfter) {
      beginShrink(particle);
      if (particle.finalBound) particle.shrinkEndTargetVx *= particle.finalSpeedMultiplier;
    }
    if (particle.shrinking) {
      const shrinkLinear = clamp((particle.age - particle.shrinkStartedAt) / particle.shrinkDuration);
      const shrinkProgress = particle.fastFinalShrink
        ? 1 - Math.pow(1 - shrinkLinear, 3)
        : smoothstep(0, 1, shrinkLinear);
      particle.radius = mix(particle.shrinkStartRadius, particle.shrinkTargetRadius, shrinkProgress);
      particle.targetVx = mix(particle.shrinkStartTargetVx, particle.shrinkEndTargetVx, shrinkProgress);
      if (shrinkProgress >= 1) {
        particle.shrinking = false;
        particle.shape = null;
        particle.sizeClass = "small";
        particle.targetVx = particle.shrinkEndTargetVx;
        particle.dragLength = random(.65, 1.22);
      }
    }

    if (particle.finalBound) {
      const group = particle.finalGroup;
      particle.x = particle.boundX + group.offsetX;
      particle.y = particle.boundY + group.offsetY;
      if (group.state === "queued" || group.offsetX < particle.fragmentReleaseDistance) return;
      particle.finalBound = false;
      particle.vx = group.currentVx;
      particle.vy = group.currentVy;
      particle.targetVx = Math.max(particle.targetVx, group.vx * particle.finalSpeedMultiplier);
    }

    const capture = smoothstep(FIELD_START + 8, CAPTURE_END, particle.x);
    const laneY = LANE_Y[particle.lane];
    const fieldBreath = .90 + .10 * Math.sin(time * .72 + particle.lane * 1.24);
    const laneWander = Math.sin(time * .54 + particle.wanderPhase + particle.x * .0035) * particle.wanderAmplitude;
    const targetY = laneY + particle.laneOffset + laneWander;
    const fieldRelease = particle.fieldReleaseDelay > 0
      ? smoothstep(particle.fieldReleaseDelay, particle.fieldReleaseDelay + .95, particle.age)
      : 1;
    let captureForce = particle.sizeClass === "large"
      ? mix(.35, 2.3, capture)
      : particle.sizeClass === "medium"
        ? mix(.8, 5.2, capture)
        : mix(1.4, 8.8, capture);
    captureForce *= particle.fieldAffinity * (particle.dense ? 1 : .58) * fieldRelease;
    const noiseAmplitude = particle.dense ? mix(92, 42, capture) : mix(185, 96, capture);
    const noise = Math.sin(time * particle.noiseRate + particle.noisePhase + particle.x * .009) * noiseAmplitude * fieldRelease;

    const baseSpeedResponse = particle.shrinking ? 4.2 : particle.sizeClass === "large" ? 1.15 : particle.sizeClass === "medium" ? 2.05 : 2.6;
    const speedResponse = baseSpeedResponse * (particle.speedResponseScale || 1);
    const speedBlend = smoothstep(particle.speedDelay || 0, (particle.speedDelay || 0) + .9, particle.age);
    const individualSpeed = 1 + Math.sin(
      time * (particle.speedRate || .4) + (particle.speedPhase || particle.noisePhase)
    ) * (particle.speedVariance || .06);
    particle.vx += (particle.targetVx * fieldBreath * individualSpeed - particle.vx) * (1 - Math.exp(-delta * speedResponse * speedBlend));
    particle.vy += ((targetY - particle.y) * captureForce + noise) * delta;
    const separation = smoothstep(particle.separationDelay || 0, (particle.separationDelay || 0) + .65, particle.age);
    particle.vy += particle.fragmentDrift * separation * delta;
    particle.vx += (particle.fragmentDriftX || 0) * separation * delta;
    const directionalDrag = particle.sizeClass === "large" ? .72 : particle.sizeClass === "medium" ? .52 : particle.dense ? .34 : .62;
    particle.vy *= Math.pow(directionalDrag, delta);
    particle.x += particle.vx * delta;
    particle.y += particle.vy * delta;

    if (particle.x > FIELD_END || particle.y < 90 || particle.y > H - 90) resetParticle(particle);
  }

  function traceShape(shape, x, y, scale = 1) {
    if (!shape || shape.length === 0) return;
    const first = shape[0];
    ctx.moveTo(x + first.a[0] * scale, y + first.a[1] * scale);
    for (let index = 0; index < shape.length; index += 1) {
      const current = shape[index];
      const next = shape[(index + 1) % shape.length];
      ctx.bezierCurveTo(
        x + current.r[0] * scale,
        y + current.r[1] * scale,
        x + next.l[0] * scale,
        y + next.l[1] * scale,
        x + next.a[0] * scale,
        y + next.a[1] * scale
      );
    }
    ctx.closePath();
  }

  function traceSquare(x, y, radius, rotation) {
    const halfSize = radius * .84;
    const cosine = Math.cos(rotation);
    const sine = Math.sin(rotation);
    const corners = [
      [-halfSize, -halfSize],
      [halfSize, -halfSize],
      [halfSize, halfSize],
      [-halfSize, halfSize]
    ];
    corners.forEach((corner, index) => {
      const px = x + corner[0] * cosine - corner[1] * sine;
      const py = y + corner[0] * sine + corner[1] * cosine;
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
  }

  function traceFourPointStar(x, y, radius, rotation) {
    const outerRadius = radius * 1.34;
    const innerRadius = radius * .13;
    const cosine = Math.cos(rotation);
    const sine = Math.sin(rotation);
    const point = (px, py) => [
      x + px * cosine - py * sine,
      y + px * sine + py * cosine
    ];
    const top = point(0, -outerRadius);
    const right = point(outerRadius, 0);
    const bottom = point(0, outerRadius);
    const left = point(-outerRadius, 0);
    const topInner = point(0, -innerRadius);
    const rightInner = point(innerRadius, 0);
    const bottomInner = point(0, innerRadius);
    const leftInner = point(-innerRadius, 0);

    ctx.moveTo(top[0], top[1]);
    ctx.bezierCurveTo(topInner[0], topInner[1], rightInner[0], rightInner[1], right[0], right[1]);
    ctx.bezierCurveTo(rightInner[0], rightInner[1], bottomInner[0], bottomInner[1], bottom[0], bottom[1]);
    ctx.bezierCurveTo(bottomInner[0], bottomInner[1], leftInner[0], leftInner[1], left[0], left[1]);
    ctx.bezierCurveTo(leftInner[0], leftInner[1], topInner[0], topInner[1], top[0], top[1]);
    ctx.closePath();
  }

  function seedFreeSparkles() {
    freeSparkles.length = 0;
    const fixedSparkles = [
      { nx: -.66, ny: -.34, radius: 4.8, rotation: 0, phase: .20, speed: 1.25 },
      { nx: -.58, ny: .40, radius: 8.2, rotation: Math.PI / 4, phase: 1.05, speed: 1.68 },
      { nx: -.34, ny: -.53, radius: 5.6, rotation: Math.PI / 4, phase: 3.18, speed: 1.34 },
      { nx: -.04, ny: -.56, radius: 6.1, rotation: 0, phase: 2.38, speed: 1.42 },
      { nx: .18, ny: .51, radius: 6.8, rotation: 0, phase: 5.16, speed: 1.73 },
      { nx: .50, ny: -.38, radius: 9.0, rotation: Math.PI / 4, phase: .72, speed: 1.88 },
      { nx: .66, ny: .26, radius: 5.4, rotation: 0, phase: 4.54, speed: 1.53 },
      { nx: .45, ny: .43, radius: 4.9, rotation: Math.PI / 4, phase: 2.82, speed: 1.61 }
    ];
    fixedSparkles.forEach(sparkle => {
      freeSparkles.push({
        x: METEOR_CENTER_X + METEOR_RADIUS_X * sparkle.nx,
        y: METEOR_CENTER_Y + METEOR_RADIUS_Y * sparkle.ny,
        radius: sparkle.radius,
        rotation: sparkle.rotation,
        phase: sparkle.phase,
        speed: sparkle.speed
      });
    });
  }

  function drawFreeSparkles() {
    if (time >= GENERATION_FULL_END) return;
    freeSparkles.forEach(sparkle => {
      const pulse = Math.pow(Math.max(0, Math.sin(time * sparkle.speed * SPARKLE_SPEED_SCALE + sparkle.phase)), 5);
      if (pulse < .015) return;
      ctx.beginPath();
      traceFourPointStar(
        sparkle.x,
        sparkle.y,
        sparkle.radius * (.42 + pulse * 1.05) * SPARKLE_RADIUS_SCALE,
        sparkle.rotation
      );
      ctx.fillStyle = `rgba(0,0,0,${.15 + pulse * .75})`;
      ctx.fill();
    });
  }

  function drawBackgroundTexture() {
    const columnStep = 156;
    const rowStep = 150;
    for (let row = 0, y = 75; y < H; row += 1, y += rowStep) {
      for (let column = 0, x = 78; x < W; column += 1, x += columnStep) {
        const variant = (row + column) % 2;
        const radius = 27;
        ctx.beginPath();
        traceFourPointStar(x, y, radius, variant === 1 ? Math.PI / 4 : 0);
        ctx.fillStyle = "rgba(105,105,105,.20)";
        ctx.fill();
      }
    }
  }

  function drawTitleMark() {
    const reveal = smoothstep(GENERATION_FULL_END - 2.05, GENERATION_FULL_END - .18, time);
    if (reveal <= 0) return;
    ctx.save();
    ctx.globalAlpha = reveal;
    ctx.font = TITLE_STYLE.font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgb(0,0,0)";
    ctx.fillText("碎", METEOR_CENTER_X - TITLE_STYLE.offset, METEOR_CENTER_Y + 8);
    ctx.fillStyle = "rgb(255,255,255)";
    ctx.fillText("屑", METEOR_CENTER_X + TITLE_STYLE.offset, METEOR_CENTER_Y + 8);
    ctx.restore();
  }

  function drawParticle(particle) {
    if (!particle.active) return;
    const speedRatio = clamp(particle.vx / 3500);
    const trail = mix(7, particle.dense ? 42 : 27, speedRatio) * particle.dragLength;
    const length = Math.max(trail, Math.min(84, particle.x - particle.previousX));
    const angle = Math.atan2(particle.y - particle.previousY, particle.x - particle.previousX);
    const tailX = particle.x - Math.cos(angle) * length;
    const tailY = particle.y - Math.sin(angle) * length;
    const [red, green, blue] = particle.color;

    if (particle.holdTime <= 0) {
      const gradient = ctx.createLinearGradient(tailX, tailY, particle.x, particle.y);
      gradient.addColorStop(0, `rgba(${red},${green},${blue},0)`);
      gradient.addColorStop(.72, `rgba(${red},${green},${blue},${particle.alpha * .42})`);
      gradient.addColorStop(1, `rgba(${red},${green},${blue},${particle.alpha})`);
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(particle.x, particle.y);
      ctx.lineCap = "round";
      ctx.lineWidth = Math.min(6.5, Math.max(1, particle.radius * .82));
      ctx.strokeStyle = gradient;
      ctx.stroke();
    }

    ctx.beginPath();
    const birthScale = 1;
    const rotation = particle.noisePhase < Math.PI ? 0 : Math.PI * .25;
    if (particle.visualShape === "star4") {
      traceFourPointStar(particle.x, particle.y, particle.radius * birthScale, rotation);
    } else {
      traceSquare(particle.x, particle.y, particle.radius * birthScale, rotation);
    }
    ctx.fillStyle = `rgb(${red},${green},${blue})`;
    ctx.fill();
  }

  function updateMeteorDots(delta) {
    // Once the large-area release starts, the surface must never refill.
    // Reappearing source dots were visually pinning a second meteor in place.
    if (finalBreakupStarted) {
      meteorDots.forEach(dot => { dot.visible = false; });
      return;
    }
    meteorDots.forEach(dot => {
      if (dot.visible) {
        dot.surfaceLife -= delta;
        return;
      }
      if (time < GENERATION_FULL_END && time >= dot.respawnAt) {
        assignRandomStructureSlot(dot);
        if (!dot.slot) return;
        dot.visible = true;
        dot.surfaceLife = surfaceDwellAt();
      }
    });
  }

  function drawMeteorLayer(renderLayer, movingMega = false, colorPass = "all") {
    meteorDots.forEach((dot, index) => {
      if (!dot.visible || dot.renderLayer !== renderLayer) return;
      const isMovingMega = !!(dot.megaGroup && dot.megaGroup.state !== "waiting");
      if (isMovingMega !== movingMega) return;
      const isBlack = dot.color[0] === 0 && dot.color[1] === 0 && dot.color[2] === 0;
      const isTopSurfaceBlack = isBlack && renderLayer === 4;
      if (colorPass === "base" && isTopSurfaceBlack) return;
      if (colorPass === "topBlack" && !isTopSurfaceBlack) return;
      const position = meteorDotPosition(dot);
      const breath = .78 + .22 * Math.sin(time * .42 + index * .19);
      const [red, green, blue] = dot.color;
      ctx.beginPath();
      const rotation = dot.phase < Math.PI ? 0 : Math.PI * .25;
      const isStar = dot.visualShape === "star4";
      const displayRadius = dot.radius * (.99 + .01 * breath) * (dot.finalScale == null ? 1 : dot.finalScale);
      if (isStar) traceFourPointStar(position.x, position.y, displayRadius, rotation);
      else traceSquare(position.x, position.y, displayRadius, rotation);
      ctx.fillStyle = `rgb(${red},${green},${blue})`;
      ctx.fill();
    });
  }

  function drawHeldParticleLayer(renderLayer, outsideMeteor = false) {
    particles.forEach(particle => {
      if (particle.active && particle.holdTime > 0 && particle.renderLayer === renderLayer && !!particle.outsideMeteor === outsideMeteor) drawParticle(particle);
    });
  }

  function drawScene(delta) {
    ctx.fillStyle = "rgb(216,216,216)";
    ctx.fillRect(0, 0, W, H);
    drawBackgroundTexture();
    drawTitleMark();

    if (delta > 0 && time < GENERATION_FULL_END) {
      // Departure stays continuous. Only replacement generation slows down,
      // so the body thins naturally instead of accumulating for a final burst.
      const departureRate = mix(
        DEPARTURE_RATE,
        FINAL_DEPARTURE_RATE,
        smoothstep(GENERATION_TAPER_START, GENERATION_FULL_END, time)
      );
      emissionAccumulator += departureRate * delta;
      const departureRequested = Math.floor(emissionAccumulator);
      if (departureRequested > 0) {
        launchReadySurfaceDots(Math.min(8, departureRequested));
        emissionAccumulator -= departureRequested;
      }

    }

    updateFinalBreakup(delta);
    particles.forEach(particle => updateParticle(particle, delta));
    updateMeteorDots(delta);

    ctx.save();
    for (let renderLayer = 0; renderLayer <= 4; renderLayer += 1) {
      drawMeteorLayer(renderLayer, false, "base");
      drawHeldParticleLayer(renderLayer, false);
    }
    // Surface black blocks are a dedicated top pass, above every white/gray layer.
    drawMeteorLayer(4, false, "topBlack");
    ctx.restore();

    for (let renderLayer = 0; renderLayer <= 4; renderLayer += 1) {
      drawMeteorLayer(renderLayer, true, "base");
      drawHeldParticleLayer(renderLayer, true);
    }
    drawMeteorLayer(4, true, "topBlack");

    particles.filter(particle => particle.active && particle.holdTime <= 0 && !particle.dense).forEach(drawParticle);
    particles.filter(particle => particle.active && particle.holdTime <= 0 && particle.dense).forEach(drawParticle);
    drawFreeSparkles();
  }

  function frame(now) {
    const delta = Math.min(.035, (now - previous) / 1000) * ANIMATION_SPEED;
    previous = now;
    if (playing) time += delta;
    drawScene(playing ? delta : 0);
    requestAnimationFrame(frame);
  }

  window.addEventListener("keydown", event => {
    if (event.code === "Space") {
      event.preventDefault();
      playing = !playing;
    }
    if (event.key.toLowerCase() === "r") {
      time = 0;
      seedField();
    }
  });

  seedField();
  requestAnimationFrame(frame);
})();
