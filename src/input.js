export class PointerInput {
  constructor(target) {
    this.target = target;
    this.isRightHeld = false;
    this.isRightKeyHeld = false;
    this.activePointerId = null;

    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerUp = this.handlePointerUp.bind(this);
    this.handlePointerLeave = this.handlePointerLeave.bind(this);
    this.handleWindowBlur = this.handleWindowBlur.bind(this);
    this.handleVisibilityChange = this.handleVisibilityChange.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleKeyUp = this.handleKeyUp.bind(this);
    this.handleContextMenu = (event) => event.preventDefault();

    target.addEventListener('pointerdown', this.handlePointerDown, { passive: false });
    target.addEventListener('pointerup', this.handlePointerUp, { passive: false });
    target.addEventListener('pointercancel', this.handlePointerUp, { passive: false });
    target.addEventListener('pointerleave', this.handlePointerLeave, { passive: false });
    target.addEventListener('pointerout', this.handlePointerLeave, { passive: false });
    target.addEventListener('contextmenu', this.handleContextMenu);
    window.addEventListener('pointerup', this.handlePointerUp, { passive: false });
    window.addEventListener('pointercancel', this.handlePointerUp, { passive: false });
    window.addEventListener('blur', this.handleWindowBlur);
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
  }

  handlePointerDown(event) {
    event.preventDefault();

    if (this.activePointerId !== null) {
      return;
    }

    this.activePointerId = event.pointerId;
    this.syncRightHeld();

    if (this.target.setPointerCapture) {
      this.target.setPointerCapture(event.pointerId);
    }
  }

  handlePointerUp(event) {
    if (this.activePointerId === null || event.pointerId === this.activePointerId) {
      this.activePointerId = null;
      this.syncRightHeld();
    }
  }

  handleKeyDown(event) {
    const key = event.key?.toLowerCase();
    if (event.code !== 'KeyD' && key !== 'd' && key !== 'д') return;
    event.preventDefault();
    this.isRightKeyHeld = true;
    this.syncRightHeld();
  }

  handleKeyUp(event) {
    const key = event.key?.toLowerCase();
    if (event.code !== 'KeyD' && key !== 'd' && key !== 'д') return;
    event.preventDefault();
    this.isRightKeyHeld = false;
    this.syncRightHeld();
  }

  handlePointerLeave(event) {
    if (event.pointerId === this.activePointerId) {
      this.activePointerId = null;
      this.syncRightHeld();
    }
  }

  handleWindowBlur() {
    this.release();
  }

  handleVisibilityChange() {
    if (document.hidden) {
      this.release();
    }
  }

  release() {
    this.activePointerId = null;
    this.isRightKeyHeld = false;
    this.syncRightHeld();
  }

  syncRightHeld() {
    this.isRightHeld = this.isRightKeyHeld || this.activePointerId !== null;
  }

  destroy() {
    this.release();
    this.target.removeEventListener('pointerdown', this.handlePointerDown);
    this.target.removeEventListener('pointerup', this.handlePointerUp);
    this.target.removeEventListener('pointercancel', this.handlePointerUp);
    this.target.removeEventListener('pointerleave', this.handlePointerLeave);
    this.target.removeEventListener('pointerout', this.handlePointerLeave);
    this.target.removeEventListener('contextmenu', this.handleContextMenu);
    window.removeEventListener('pointerup', this.handlePointerUp);
    window.removeEventListener('pointercancel', this.handlePointerUp);
    window.removeEventListener('blur', this.handleWindowBlur);
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
  }
}
