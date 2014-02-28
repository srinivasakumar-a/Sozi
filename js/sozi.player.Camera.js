/*
 * Sozi - A presentation tool using the SVG standard
 *
 * Copyright (C) 2010-2013 Guillaume Savaton
 *
 * This program is dual licensed under the terms of the MIT license
 * or the GNU General Public License (GPL) version 3.
 * A copy of both licenses is provided in the doc/ folder of the
 * official release of Sozi.
 *
 * See http://sozi.baierouge.fr/wiki/en:license for details.
 */

namespace("sozi.player", function (exports) {
    "use strict";

    // Constant: the Sozi namespace
    var SVG_NS = "http://www.w3.org/2000/svg";

    exports.CameraState = sozi.model.Object.create({

        init: function (svgRoot) {
            sozi.model.Object.init.call(this);

            this.svgRoot = svgRoot;

            var initialBBox = svgRoot.getBBox();

            // Center coordinates
            this.cx = initialBBox.x + initialBBox.width / 2;
            this.cy = initialBBox.y + initialBBox.height / 2;

            // Dimensions
            this.width = initialBBox.width;
            this.height = initialBBox.height;

            // Rotation angle, in degrees
            this.angle = 0;

            // Clipping
            this.clipped = false;

            return this;
        },

        /*
         * Set the angle of the current camera state.
         * The angle of the current state is normalized
         * in the interval [-180 ; 180]
         */
        setAngle: function (angle) {
            this.angle = (angle + 180) % 360 - 180;
            return this;
        },

        /*
         * Set the current camera's properties to the given SVG element.
         *
         * Otherwise, the properties of the frame are based on the bounding box
         * of the given element.
         *
         * Parameters:
         *    - svgElement: an element from the SVG DOM
         */
        setAtElement: function (svgElement) {
            // Read the raw bounding box of the given SVG element
            var b = svgElement.getBBox();

            // Compute the raw coordinates of the center
            // of the given SVG element
            var c = this.svgRoot.createSVGPoint();
            c.x = b.x + b.width  / 2;
            c.y = b.y + b.height / 2;

            // Compute the coordinates of the center of the given SVG element
            // after its current transformation
            var matrix = svgElement.getCTM();
            c = c.matrixTransform(matrix);

            // Compute the scaling factor applied to the given SVG element
            var scale = Math.sqrt(matrix.a * matrix.a + matrix.b * matrix.b);

            // Update the camera to match the bounding box information of the
            // given SVG element after its current transformation
            this.cx     = c.x;
            this.cy     = c.y;
            this.width  = b.width  * scale;
            this.height = b.height * scale;
            this.angle  = Math.atan2(matrix.b, matrix.a) * 180 / Math.PI;

            return this;
        },

        setAtState: function (state) {
            return this.set({
                cx: state.cx,
                cy: state.cy,
                width: state.width,
                height: state.height,
                angle: state.angle,
                clipped: state.clipped
            });
        },

        clone: function () {
            return exports.CameraState.create().init(this.svgRoot).setAtState(this);
        },

        interpolate: function (initialState, finalState, progress, relativeZoom, svgPath, reversePath) {
            var remaining = 1 - progress;

            function linear(initial, final) {
                return final * progress + initial * remaining;
            }

            function quadratic(u0, u1) {
                var um = relativeZoom > 0 ?
                    Math.max(u0, u1) * (1 + relativeZoom) :
                    Math.min(u0, u1) * (1 - relativeZoom);
                var du0 = u0 - um;
                var du1 = u1 - um;
                var r = Math.sqrt(du0 / du1);
                var tm = r / (1 + r);
                var k = du0 / tm / tm;
                var dt = progress - tm;
                return k * dt * dt + um;
            }

            // Interpolate camera width and height
            if (relativeZoom) {
                this.width  = quadratic(initialState.width,  finalState.width);
                this.height = quadratic(initialState.height, finalState.height);
            }
            else {
                this.width  = linear(initialState.width,  finalState.width);
                this.height = linear(initialState.height, finalState.height);
            }

            // Interpolate camera location
            if (svgPath) {
                var pathLength   = svgPath.getTotalLength();
                var startPoint   = svgPath.getPointAtLength(reversePath ? pathLength : 0);
                var endPoint     = svgPath.getPointAtLength(reversePath ? 0 : pathLength);
                var currentPoint = svgPath.getPointAtLength(pathLength * (reversePath ? remaining : progress));

                this.cx = currentPoint.x + linear(initialState.cx - startPoint.x, finalState.cx - endPoint.x);
                this.cy = currentPoint.y + linear(initialState.cy - startPoint.y, finalState.cy - endPoint.y);
            }
            else {
                this.cx = linear(initialState.cx, finalState.cx);
                this.cy = linear(initialState.cy, finalState.cy);
            }

            // Interpolate camera angle
            // Keep the smallest angle between the initial and final states
            if (finalState.angle - initialState.angle > 180) {
                this.angle  = linear(initialState.angle, finalState.angle - 360);
            }
            else if (finalState.angle - initialState.angle < -180) {
                this.angle  = linear(initialState.angle - 360, finalState.angle);
            }
            else {
                this.angle  = linear(initialState.angle, finalState.angle);
            }
        }
    });

    exports.Camera = exports.CameraState.create({

        init: function (viewport, layer) {
            exports.CameraState.init.call(this, viewport.svgRoot);

            this.viewport = viewport;
            this.layer = layer;
            this.selected = true;

            // The clipping rectangle of this camera
            this.svgClipRect = document.createElementNS(SVG_NS, "rect");

            // The clipping path of this camera
            var svgClipPath = document.createElementNS(SVG_NS, "clipPath");
            svgClipPath.setAttribute("id", "sozi-clip-path-" + viewport.id + "-" + this.id);
            svgClipPath.appendChild(this.svgClipRect);
            viewport.svgRoot.appendChild(svgClipPath);

            // The group that will support the clipping operation
            var svgClippedGroup = document.createElementNS(SVG_NS, "g");
            svgClippedGroup.setAttribute("clip-path", "url(#sozi-clip-path-" + viewport.id + "-" + this.id + ")");
            viewport.svgRoot.appendChild(svgClippedGroup);

            // The groups that will support transformations
            this.svgTransformGroups = layer.svgNodes.map(function (svgNode) {
                var svgGroup = document.createElementNS(SVG_NS, "g");
                svgGroup.appendChild(svgNode);
                svgClippedGroup.appendChild(svgGroup);
                return svgGroup;
            }, this);

            return this;
        },

        setAtState: function (state) {
            return exports.CameraState.setAtState.call(this, state).update();
        },

        get scale() {
            return Math.min(this.viewport.width / this.width, this.viewport.height / this.height);
        },

        rotate: function (angle) {
            return this.setAngle(this.angle + angle).update();
        },

        zoom: function (factor, x, y) {
            this.width /= factor;
            this.height /= factor;
            return this.drag(
                (1 - factor) * (x - this.viewport.width  / 2),
                (1 - factor) * (y - this.viewport.height / 2)
            );
        },

        drag: function (deltaX, deltaY) {
            var scale = this.scale;
            var angleRad = this.angle * Math.PI / 180;
            var si = Math.sin(angleRad);
            var co = Math.cos(angleRad);
            this.clipped = false;
            this.cx -= (deltaX * co - deltaY * si) / scale;
            this.cy -= (deltaX * si + deltaY * co) / scale;
            return this.update();
        },

        update: function () {
            var scale = this.scale;

            // Compute the size and location of the frame on the screen
            var width = this.width  * scale;
            var height = this.height * scale;
            var x = (this.viewport.width - width) / 2;
            var y = (this.viewport.height - height) / 2;

            // Adjust the location and size of the clipping rectangle and the frame rectangle
            this.svgClipRect.setAttribute("x", this.clipped ? x : 0);
            this.svgClipRect.setAttribute("y", this.clipped ? y : 0);
            this.svgClipRect.setAttribute("width",  this.clipped ? width  : this.viewport.width);
            this.svgClipRect.setAttribute("height", this.clipped ? height : this.viewport.height);

            // Compute and apply the geometrical transformation to the layer group
            var translateX = -this.cx + this.width / 2  + x / scale;
            var translateY = -this.cy + this.height / 2 + y / scale;

            this.svgTransformGroups.forEach(function (svgGroup) {
                svgGroup.setAttribute("transform",
                    "scale(" + scale + ")" +
                    "translate(" + translateX + "," + translateY + ")" +
                    "rotate(" + (-this.angle) + ',' + this.cx + "," + this.cy + ")"
                );
            }, this);

            return this;
        }
    });
});
