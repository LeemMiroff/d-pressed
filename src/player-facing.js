const SIDE_YAW = Math.PI / 2;
const TURN_SPEED = Math.PI / 0.16;
const ENEMY_ACQUIRE_DISTANCE = 20;
const ENEMY_RELEASE_DISTANCE = 28;
const ENEMY_DIRECTION_DEAD_ZONE = 1;
const STABLE_INPUT_DURATION = 0.5;

export class PlayerFacing {
  constructor() {
    this.reset();
  }

  reset(direction = -1) {
    this.yaw = direction * SIDE_YAW;
    this.targetYaw = this.yaw;
    this.held = false;
    this.inputStableTime = Infinity;
    this.holdFacing = false;
    this.enemyTarget = null;
  }

  updateForPlayer(dt, player, held = false) {
    const turning = this.yaw !== this.targetYaw;
    this.inputStableTime += dt;
    if (held !== this.held) {
      if (turning && !this.enemyTarget) this.holdFacing = true;
      this.held = held;
      this.inputStableTime = 0;
    } else if (this.inputStableTime >= STABLE_INPUT_DURATION - 1e-9) {
      this.holdFacing = false;
    }
    const movementDirection = Math.sign(player.vx);
    // Each platform can hold at most one enemy.
    const enemy = player.groundedOn?.enemy;
    const validEnemy = enemy?.active && !enemy.defeated && enemy.platform === player.groundedOn;
    if (validEnemy) {
      const offset = enemy.x + enemy.width / 2 - player.x - player.width / 2;
      const distance = Math.abs(offset);
      const range = enemy === this.enemyTarget ? ENEMY_RELEASE_DISTANCE : ENEMY_ACQUIRE_DISTANCE;
      if (distance <= range) {
        this.enemyTarget = enemy;
        const direction = distance <= ENEMY_DIRECTION_DEAD_ZONE ? Math.sign(this.targetYaw) : Math.sign(offset);
        this.turnTowards(direction, dt);
        return this.playbackDirection(movementDirection);
      }
    }
    this.enemyTarget = null;
    if (turning) {
      this.turnTowards(Math.sign(this.targetYaw), dt);
    } else if (!this.holdFacing) {
      this.turnTowards(held ? 1 : -1, dt);
    }
    return this.playbackDirection(movementDirection);
  }

  turnTowards(direction, dt) {
    this.targetYaw = direction * SIDE_YAW;
    const step = dt * TURN_SPEED;
    const difference = this.targetYaw - this.yaw;
    this.yaw = Math.abs(difference) <= step + 1e-9
      ? this.targetYaw
      : this.yaw + Math.sign(difference) * step;
  }

  playbackDirection(movementDirection) {
    const facingSide = Math.abs(this.yaw) < 1e-9 ? Math.sign(this.targetYaw) : Math.sign(this.yaw);
    return movementDirection && movementDirection !== facingSide ? -1 : 1;
  }
}
