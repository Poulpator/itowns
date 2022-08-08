import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'ThreeExtended/renderers/CSS2DRenderer';
import { MAIN_LOOP_EVENTS } from 'Core/MainLoop';
import Coordinates from 'Core/Geographic/Coordinates';
import DEMUtils from 'Utils/DEMUtils';
import { CONTROL_EVENTS } from 'Controls/GlobeControls';
import Widget from './Widget';

const DEFAULT_OPTIONS = {
    position: 'top',
    width: 50,
    height: 50,
    placeholder: 'Measure elevation',
};

const loader = new THREE.TextureLoader();
const POINT_TEXTURE = loader.load('sprites/mycircle.png'); // TODO: update url once PR itowns sample data accepted

const MOVE_POINT_MATERIAL = new THREE.PointsMaterial({
    color: 0xff0000,
    size: 10.0,
    map: POINT_TEXTURE,
    alphaTest: 0.5,
    sizeAttenuation: false,
    depthTest: false, // allows to render the point above the objects of the scene (used with renderOrder = 1)
});

const CLICK_POINT_MATERIAL = MOVE_POINT_MATERIAL.clone();
CLICK_POINT_MATERIAL.color.set(0xffffff);

/**
 * Widget to measure the elevation in the 3D scene. Click anywhere in the scene to measure and display the elevation.
 * Works on all layers that can be added to itowns: 3D Tiles, terrain, etc.
 *
 * @extends Widget
 *
 * @property {HTMLElement} domElement An html div containing the searchbar.
 * @property {HTMLElement} parentElement The parent HTML container of `this.domElement`.
 * @property {Number} [decimals=2] The number of decimals of the measured elevation.
 * @property {String} [noElevationText='-'] The text to display when the elevation value is not found (e.g. if the user
 * tries to measure the elevation where there is no elevation texture available).
 */
class ElevationMeasure extends Widget {
    // --- Internal fields
    // boolean indicating whether the tool is active or not
    #active;
    // the view where to pick
    #view;
    // a point following the mouse pointer
    #movePoint;
    // a point displayed where the user clicks to mesure elevation
    #clickPoint;
    // the threejs CSS2DRenderer used to display the label containing the elevation
    #labelRenderer;
    // the threejs label object
    #labelObj;
    // boolean used to check if the user is dragging (don't mesure elevation or just clicking (mesure elevation)
    #drag = false;
    // store previous mouse move event (and hence last mouse position) to move the movePoint when zooming in or out
    #previousMouseMoveEvent = null;

    // --- Config options
    decimals = 2;
    noElevationText = '-';
    movePointMaterial = MOVE_POINT_MATERIAL;
    clickPointMaterial = CLICK_POINT_MATERIAL;

    /**
     *
     * @param {View} view the iTowns view in which the tool will measure elevation
     * @param {Object} options The elevation measurement tool optional configuration
     * @param {HTMLElement} [options.parentElement=view.domElement] The parent HTML container of the div which
     *                                                              contains searchbar widgets.
     * @param {String} [options.position='top'] Defines which position within the
     *                                          `parentElement` the searchbar should be
                                                                        * displayed to. Possible values are `top`,
                                                                        * `bottom`, `left`, `right`, `top-left`,
                                                                        * `top-right`, `bottom-left` and `bottom-right`.
                                                                        * If the input value does not match one of
                                                                        * these, it will be defaulted to `top`.
    * @param {number} [options.width=50] The width in pixels of the scale.
    * @param {number} [options.height=50] The height in pixels of the scale.
    * @param {Number} [options.decimals=2] The number of decimals of the measured elevation
    * @param {String} [options.noElevationText='-'] The text to display when the elevation value is not found (e.g. if
    * the user tries to measure the elevation where there is no elevation texture available).
    * @param {Material|Object} [options.movePointMaterial='THREE.PointsMaterial'] Either the material of the point
    * moving under the cursor (e.g. THREE.PointsMaterial) or options of THREE.PointsMaterial that should be applied to
    * the default material (e.g. {color: 0x0000FF} for a blue point). If not set, defaults to a THREE.PointsMaterial
    * with a circle sprite, red color and 10px size.
    * @param {Material|Object} [options.clickPointMaterial='THREE.PointsMaterial'] Either the material of the point
    * where the elevation is measured (e.g. THREE.PointsMaterial) or options of THREE.PointsMaterial that should be
    * applied to the default material (e.g. {size: 20} for a point of size 20px). If not set, defaults to a
    * THREE.PointsMaterial with a circle sprite, white color and 10px size.
    */
    constructor(view, options = {}) {
        super(view, options, DEFAULT_OPTIONS);

        if (options.decimals !== null && options.decimals !== undefined && !isNaN(options.decimals) &&
            options.decimals >= 0) {
            this.decimals = options.decimals;
        }
        if (options.noElevationText &&
            (typeof options.noElevationText === 'string' || options.noElevationText instanceof String)) {
            this.noElevationText = options.noElevationText;
        }
        if (options.movePointMaterial) {
            if (options.movePointMaterial.isMaterial) {
                this.movePointMaterial = options.movePointMaterial;
                // render the point above the objects of the scene (used with renderOrder = 1)
                this.movePointMaterial.depthTest = false;
            } else if (typeof options.movePointMaterial === 'object') {
                this.movePointMaterial.setValues(options.movePointMaterial);
            } else {
                console.warn('[Elevation measure widget] Material options should either be a THREE.Material or an object.');
            }
        }
        if (options.clickPointMaterial) {
            if (options.clickPointMaterial.isMaterial) {
                this.clickPointMaterial = options.clickPointMaterial;
                // render the point above the objects of the scene (used with renderOrder = 1)
                this.clickPointMaterial.depthTest = false;
            } else if (typeof options.clickPointMaterial === 'object') {
                this.clickPointMaterial.setValues(options.clickPointMaterial);
            } else {
                console.warn('[Elevation measure widget] Material options should either be a THREE.Material or an object.');
            }
        }

        this.#view = view;
        this.#active = false;
        this.domElement.id = 'widgets-elevation';

        const activationButton = document.createElement('button');
        activationButton.id = 'widgets-elevation-activation-button';
        activationButton.classList.add('widget-button');
        activationButton.addEventListener('mousedown', this.onButtonClick.bind(this));
        this.domElement.appendChild(activationButton);
    }

    /**
     * Activate or deactivate tool
     */
    onButtonClick() {
        this.#active = !this.#active;
        if (this.#active) {
            document.getElementById('widgets-elevation-activation-button').classList.add('widget-button-active');
            this.activateTool();
        } else {
            document.getElementById('widgets-elevation-activation-button').classList.remove('widget-button-active');
            this.deactivateTool();
        }
    }

    /**
     * Bind events of the tool and init labels stuff to display the elevation value
     */
    activateTool() {
        // Save function signatures with binding to be able to remove the eventListener in deactivateTool
        this.onMouseDown = this.onMouseDown.bind(this);
        this.onMouseMove = this.onMouseMove.bind(this);
        this.onMouseUp = this.onMouseUp.bind(this);
        this.onZoom = this.onZoom.bind(this);
        window.addEventListener('mousedown', this.onMouseDown);
        window.addEventListener('mousemove', this.onMouseMove);
        window.addEventListener('mouseup', this.onMouseUp);
        this.#view.controls.addEventListener(CONTROL_EVENTS.RANGE_CHANGED, this.onZoom);

        this.initLabel();
    }

    /**
     * Go back to a state before the tool has been activated: remove event listeners, points and labels
     */
    deactivateTool() {
        window.removeEventListener('mousedown', this.onMouseDown);
        window.removeEventListener('mousemove', this.onMouseMove);
        window.removeEventListener('mouseup', this.onMouseUp);
        this.#view.controls.removeEventListener(CONTROL_EVENTS.RANGE_CHANGED, this.onZoom);

        this.removePoints();
        this.removeLabel();
    }

    /**
     * Create or update a point in the 3D scene that follows the mouse cursor
     * @param {Event} event mouse event
     */
    onMouseMove(event) {
        this.#drag = true;
        this.#previousMouseMoveEvent = event;

        const worldCoordinates = this.#view.pickCoordinates(event);
        const pointVec3 = worldCoordinates.toVector3();
        const pointTypedArr = new Float32Array(pointVec3.toArray());

        if (!this.#movePoint) {
            const pointGeom = new THREE.BufferGeometry();
            pointGeom.setAttribute('position', new THREE.BufferAttribute(pointTypedArr, 3));
            this.#movePoint = new THREE.Points(pointGeom, this.movePointMaterial);
            this.#movePoint.frustumCulled = false; // Avoid the point to be frustum culled when zooming in.
            this.#movePoint.renderOrder = 1; // allows to render the point above the other 3D objects
            this.#view.scene.add(this.#movePoint);
        } else {
            const pos = this.#movePoint.geometry.attributes.position;
            pos.array = pointTypedArr;
            pos.needsUpdate = true;
        }
        this.#view.notifyChange();
    }

    onMouseDown() {
        this.#drag = false;
    }

    /**
     * Create or update a point where the user chose to display the elevation.
     * @param {Event} event mouse event
     */
    // TODO: refactor
    onMouseUp(event) {
        // Verify it's a left click and it's not a drag movement
        if (event.button !== 0 || this.#drag === true) {
            return;
        }

        const worldCoordinates = this.#view.pickCoordinates(event);
        const pointVec3 = worldCoordinates.toVector3();
        const pointTypedArr = new Float32Array(pointVec3.toArray());

        if (!this.#clickPoint) {
            const pointGeom = new THREE.BufferGeometry();
            pointGeom.setAttribute('position', new THREE.BufferAttribute(pointTypedArr, 3));
            this.#clickPoint = new THREE.Points(pointGeom, this.clickPointMaterial);
            this.#clickPoint.updateMatrixWorld();
            this.#clickPoint.frustumCulled = false; // Avoid the point to be frustum culled when zooming in.
            this.#clickPoint.renderOrder = 1; // allows to render the point above the other 3D objects
            this.#view.scene.add(this.#clickPoint);
        } else {
            const pos = this.#clickPoint.geometry.attributes.position;
            pos.array = pointTypedArr;
            pos.needsUpdate = true;
        }

        this.#view.notifyChange(true);

        const pickedObjs = this.#view.pickObjectsAt(event);

        let elevationText = this.noElevationText;
        if (pickedObjs) {
            const geometricObj = [];
            let tileMeshObj = null;
            for (const obj of pickedObjs) {
                if (obj.distance !== null && obj.distance !== undefined) {
                    geometricObj.push(obj);
                } else if (obj.object.isTileMesh) {
                    tileMeshObj = obj;
                } else {
                    console.warn('Elevation measure not yet supported for features of PotreeLayer');
                }
            }
            if (geometricObj.length !== 0) {
                geometricObj.sort((o1, o2) => o1.distance - o2.distance);
                const closestObj = geometricObj[0];
                const pickedPoint = new Coordinates(this.#view.referenceCrs, closestObj.point);
                const pickedPoint4326 = new Coordinates('EPSG:4326');
                pickedPoint.as('EPSG:4326', pickedPoint4326);
                elevationText = `${pickedPoint4326.z.toFixed(this.decimals)} m`;
            } else if (tileMeshObj) {
                const elevation = DEMUtils.getElevationValueAt(this.#view.tileLayer, worldCoordinates);
                if (elevation !== null && elevation !== undefined && !isNaN(elevation)) {
                    elevationText = `${elevation.toFixed(this.decimals)} m`;
                }
            }
        }
        this.updateLabel(elevationText, pointVec3);
    }

    onZoom() {
        const worldCoordinates = this.#view.pickCoordinates(this.#previousMouseMoveEvent);
        const pointVec3 = worldCoordinates.toVector3();
        const pointTypedArr = new Float32Array(pointVec3.toArray());

        if (!this.#movePoint) {
            const pointGeom = new THREE.BufferGeometry();
            pointGeom.setAttribute('position', new THREE.BufferAttribute(pointTypedArr, 3));
            this.#movePoint = new THREE.Points(pointGeom, this.movePointMaterial);
            this.#movePoint.frustumCulled = false; // Avoid the point to be frustum culled when zooming in.
            this.#movePoint.renderOrder = 1; // allows to render the point above the other 3D objects
            this.#view.scene.add(this.#movePoint);
        } else {
            const pos = this.#movePoint.geometry.attributes.position;
            pos.array = pointTypedArr;
            pos.needsUpdate = true;
        }
        this.#view.notifyChange();
    }

    /**
     * Initialize all elements to display the measured elevation as a label with threejs: a threejs css 2D renderer,
     * a callback to render the label at each frame, the div holding the label and a threejs label object.
     */
    initLabel() {
        this.#labelRenderer = new CSS2DRenderer();
        this.#labelRenderer.setSize(window.innerWidth, window.innerHeight);
        this.#labelRenderer.domElement.style.position = 'absolute';
        this.#labelRenderer.domElement.style.top = '0px';
        document.body.appendChild(this.#labelRenderer.domElement);

        this.renderLabel = this.renderLabel.bind(this);
        this.#view.addFrameRequester(MAIN_LOOP_EVENTS.AFTER_RENDER, this.renderLabel);

        const labelDiv = document.createElement('div');
        // hack to position the label above the click point: add a child div containing a translation (if we put it in 
        // labelDiv directly, it gets overwritten by threejs CSS2DRenderer)
        const posLabel = document.createElement('div');
        posLabel.classList.add('label-elevation');
        const pointSize = this.clickPointMaterial.size;
        posLabel.style.transform = `translateY(${-((pointSize / 2) + 12)}px)`; // TODO: dépend de la taille de la police et autre... le rendre paramétrable ? Trouver un autre moyen ? A documenter en tous cas
        labelDiv.appendChild(posLabel);
        this.#labelObj = new CSS2DObject(labelDiv);
        this.#view.scene.add(this.#labelObj);

        this.onWindowResize = this.onWindowResize.bind(this);
        window.addEventListener('resize', this.onWindowResize);
    }


    /**
     * Callback to render label (called at each frame)
     */
    renderLabel() {
        this.#labelRenderer.render(this.#view.scene, this.#view.camera.camera3D);
    }

    /**
     * Update label content and position
     * @param {String} textContent the new text of the label
     * @param {Vector3} position the new position of the label
     */
    updateLabel(textContent, position) {
        // Update the posLabel div textContent
        this.#labelObj.element.childNodes[0].textContent = textContent;
        this.#labelObj.position.copy(position);
        this.#labelObj.updateMatrixWorld();
    }

    /**
     * Remove label stuff: Div holding the labels, the render label function callback and the threejs label object.
     * Also initialize label related class properties to null.
     */
    removeLabel() {
        document.body.removeChild(this.#labelRenderer.domElement);
        this.#labelRenderer = null;
        this.#view.removeFrameRequester(MAIN_LOOP_EVENTS.AFTER_RENDER, this.renderLabel);
        this.#view.scene.remove(this.#labelObj);
        this.#labelObj = null;

        this.#view.notifyChange();
    }

    /**
     * Resize label renderer size
     */
    onWindowResize() {
        this.#labelRenderer.setSize(window.innerWidth, window.innerHeight);
    }

    /**
     * Remove points objects, geometries, materials and textures and reinitialize points.
     */
    removePoints() {
        if (this.#movePoint) {
            const movePointGeom = this.#movePoint.geometry;
            this.#view.scene.remove(this.#movePoint);
            this.#movePoint = null;
            movePointGeom.dispose();
            this.movePointMaterial.dispose();
        }

        if (this.#clickPoint) {
            const clickPointGeom = this.#clickPoint.geometry;
            this.#view.scene.remove(this.#clickPoint);
            this.#clickPoint = null;
            clickPointGeom.dispose();
            this.clickPointMaterial.dispose();
        }

        POINT_TEXTURE.dispose();
    }
}

export default ElevationMeasure;
