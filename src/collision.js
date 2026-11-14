function horizontalOverlap(leftA, rightA, leftB, rightB) {
  return rightA > leftB && leftA < rightB;
}

export function findLandingPlatform(player, previousBottom, nextBottom, platforms) {
  let landingPlatform = null;
  let landingTop = Number.POSITIVE_INFINITY;

  for (const platform of platforms) {
    if (!platform.active || !platform.node.visible) {
      continue;
    }

    const previousRelativeBottom = previousBottom - platform.previousY;
    const nextRelativeBottom = nextBottom - platform.y;
    const overlaps = horizontalOverlap(
      player.x,
      player.x + player.width,
      platform.x,
      platform.x + platform.width,
    );

    if (previousRelativeBottom <= 0 && nextRelativeBottom >= 0 && overlaps && platform.y < landingTop) {
      landingPlatform = platform;
      landingTop = platform.y;
    }
  }

  return landingPlatform;
}

export function isOnPlatform(player, platform) {
  return horizontalOverlap(
    player.x,
    player.x + player.width,
    platform.x,
    platform.x + platform.width,
  );
}
