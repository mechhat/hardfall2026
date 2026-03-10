/**
 * Shared timeline bar rendering for analysis marks.
 * Used by both analysis detail page (interactive) and event page (static, grouped by team).
 */
(function() {
    'use strict';

    const GAME_DURATION = 163;
    const PHASES = [
        { label: 'AUTO', duration: 23, color: '#4CAF50' },
        { label: 'TRANSITION', duration: 10, color: '#9E9E9E' },
        { label: 'SHIFT 1', duration: 25, color: '#2196F3' },
        { label: 'SHIFT 2', duration: 25, color: '#1976D2' },
        { label: 'SHIFT 3', duration: 25, color: '#1565C0' },
        { label: 'SHIFT 4', duration: 25, color: '#0D47A1' },
        { label: 'END GAME', duration: 30, color: '#FF9800' },
    ];

    function findPhaseMark(marks, actionsById, code) {
        const mark = marks.find(function(m) {
            const action = actionsById[m.action_id];
            return action && action.code === code;
        });
        return mark ? mark.time_seconds : null;
    }

    function getTimelineVideoStart(marks, actionsById) {
        var telTime = findPhaseMark(marks, actionsById, 'TEL');
        if (telTime !== null) return telTime - 23;
        var autTime = findPhaseMark(marks, actionsById, 'AUT');
        if (autTime !== null) return autTime;
        return 0;
    }

    function videoTimeToTimelinePct(videoTime, videoStart) {
        if (videoStart === null) return null;
        var gameTime = videoTime - videoStart;
        if (gameTime < 0 || gameTime > GAME_DURATION) return null;
        return (gameTime / GAME_DURATION) * 100;
    }

    function timelinePctToVideoTime(pct, videoStart) {
        if (videoStart === null) return null;
        return videoStart + (pct / 100) * GAME_DURATION;
    }

    /**
     * Create a timeline bar element.
     * @param {Object} options
     * @param {Array} options.marks - Marks with time_seconds, action_id
     * @param {Object} options.actionsById - Map of action id to action
     * @param {HTMLElement} [options.container] - If set, append into this element
     * @param {string} [options.linkHref] - If set, wrap timeline in link
     * @param {boolean} [options.addPlayhead=false] - If true, add playhead element for video sync
     * @param {number} [options.height=24] - Bar height in px
     * @param {string} [options.width] - Width e.g. '400px' (ensures bar is visible)
     * @param {string} [options.maxWidth] - Max width e.g. '1280px' or '200px'
     * @returns {Object} { element, getVideoStart, videoTimeToTimelinePct, timelinePctToVideoTime, marksLayer, playheadEl }
     */
    function createTimelineBar(options) {
        const marks = options.marks || [];
        const actionsById = options.actionsById || {};
        const linkHref = options.linkHref || null;
        const height = options.height || 24;
        const width = options.width || null;
        const maxWidth = options.maxWidth || '100%';

        const videoStart = getTimelineVideoStart(marks, actionsById);

        const container = document.createElement('div');
        var sizeStyle = 'height: ' + height + 'px; max-width: ' + maxWidth + ';';
        if (width) sizeStyle += ' width: ' + width + '; min-width: ' + width + ';';
        container.style.cssText = 'position: relative; border-radius: 4px; overflow: hidden; font-size: 11px; font-weight: bold; color: white; ' + sizeStyle;

        const phasesDiv = document.createElement('div');
        phasesDiv.style.cssText = 'position: absolute; top: 0; left: 0; right: 0; bottom: 0; display: flex;';
        PHASES.forEach(function(phase) {
            const section = document.createElement('div');
            const widthPct = (phase.duration / GAME_DURATION) * 100;
            section.style.cssText = 'width: ' + widthPct + '%; background: ' + phase.color + '; display: flex; align-items: center; justify-content: center; overflow: hidden; white-space: nowrap;';
            section.textContent = phase.label;
            section.title = phase.label + ' (' + phase.duration + 's)';
            phasesDiv.appendChild(section);
        });
        container.appendChild(phasesDiv);

        const marksLayer = document.createElement('div');
        marksLayer.style.cssText = 'position: absolute; top: 0; left: 0; right: 0; bottom: 0; pointer-events: none; z-index: 1;';
        marks.forEach(function(mark) {
            const pct = videoTimeToTimelinePct(mark.time_seconds, videoStart);
            if (pct === null) return;
            const el = document.createElement('div');
            el.style.cssText = 'position: absolute; bottom: 0; width: 1px; height: 5px; background: white; left: ' + pct + '%;';
            marksLayer.appendChild(el);
        });
        container.appendChild(marksLayer);

        let playheadEl = null;
        if (options.addPlayhead) {
            playheadEl = document.createElement('div');
            playheadEl.style.cssText = 'position: absolute; top: 0; width: 1px; height: 100%; background: white; pointer-events: none; display: none; z-index: 2;';
            container.appendChild(playheadEl);
        }

        if (linkHref) {
            const link = document.createElement('a');
            link.href = linkHref;
            link.style.cssText = 'display: block; position: absolute; top: 0; left: 0; right: 0; bottom: 0; z-index: 2; cursor: pointer;';
            container.appendChild(link);
        }

        if (options.container) {
            options.container.innerHTML = '';
            options.container.appendChild(container);
        }

        return {
            element: container,
            getVideoStart: function() { return videoStart; },
            videoTimeToTimelinePct: function(t) { return videoTimeToTimelinePct(t, videoStart); },
            timelinePctToVideoTime: function(pct) { return timelinePctToVideoTime(pct, videoStart); },
            marksLayer: marksLayer,
            playheadEl: playheadEl
        };
    }

    window.TimelineBar = {
        GAME_DURATION: GAME_DURATION,
        PHASES: PHASES,
        createTimelineBar: createTimelineBar,
        getTimelineVideoStart: getTimelineVideoStart,
        videoTimeToTimelinePct: videoTimeToTimelinePct,
        timelinePctToVideoTime: timelinePctToVideoTime
    };
})();
