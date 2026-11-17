export const GAME_STATES = Object.freeze({
  BOOT: 'boot',
  HUB: 'hub',
  RUN: 'run',
  TRANSITION: 'transition',
  GAME_OVER: 'game-over',
});

export class GameSession {
  constructor(initialState = GAME_STATES.BOOT) {
    this.state = initialState;
  }

  transition(nextState) {
    if (!Object.values(GAME_STATES).includes(nextState)) throw new Error(`Unknown game state: ${nextState}`);
    this.state = nextState;
    return this.state;
  }

  is(state) {
    return this.state === state;
  }
}
