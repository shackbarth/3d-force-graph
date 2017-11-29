'use strict';

function __$styleInject(css, returnValue) {
  if (typeof document === 'undefined') {
    return returnValue;
  }
  css = css || '';
  var head = document.head || document.getElementsByTagName('head')[0];
  var style = document.createElement('style');
  style.type = 'text/css';
  head.appendChild(style);
  
  if (style.styleSheet){
    style.styleSheet.cssText = css;
  } else {
    style.appendChild(document.createTextNode(css));
  }
  return returnValue;
}

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var THREE = require('three');
var trackballControls = _interopDefault(require('three-trackballcontrols'));
var qwest = _interopDefault(require('qwest'));
var accessorFn = _interopDefault(require('accessor-fn'));
var d3 = require('d3-force-3d');
var graph = _interopDefault(require('ngraph.graph'));
var forcelayout = _interopDefault(require('ngraph.forcelayout'));
var forcelayout3d = _interopDefault(require('ngraph.forcelayout3d'));
var Kapsule = _interopDefault(require('kapsule'));
var d3ScaleChromatic = require('d3-scale-chromatic');
var tinyColor = _interopDefault(require('tinycolor2'));

__$styleInject(".graph-nav-info {\n    position: absolute;\n    bottom: 5px;\n    width: 100%;\n    text-align: center;\n    color: slategrey;\n    opacity: 0.7;\n    font-size: 10px;\n}\n\n.graph-info-msg {\n    position: absolute;\n    top: 50%;\n    width: 100%;\n    text-align: center;\n    color: lavender;\n    opacity: 0.7;\n    font-size: 22px;\n}\n\n.graph-tooltip {\n    position: absolute;\n    color: lavender;\n    font-size: 18px;\n}", undefined);

var colorStr2Hex = function colorStr2Hex(str) {
    return isNaN(str) ? parseInt(tinyColor(str).toHex(), 16) : str;
};

function autoColorNodes(nodes, colorByAccessor, colorField) {
    if (!colorByAccessor || typeof colorField !== 'string') return;

    var colors = d3ScaleChromatic.schemePaired; // Paired color set from color brewer

    var uncoloredNodes = nodes.filter(function (node) {
        return !node[colorField];
    });
    var nodeGroups = {};

    uncoloredNodes.forEach(function (node) {
        nodeGroups[colorByAccessor(node)] = null;
    });
    Object.keys(nodeGroups).forEach(function (group, idx) {
        nodeGroups[group] = idx;
    });

    uncoloredNodes.forEach(function (node) {
        node[colorField] = colors[nodeGroups[colorByAccessor(node)] % colors.length];
    });
}

var ngraph = { graph: graph, forcelayout: forcelayout, forcelayout3d: forcelayout3d };

//

var CAMERA_DISTANCE2NODES_FACTOR = 150;

var _3dForceGraph = Kapsule({

    props: {
        width: { default: window.innerWidth },
        height: { default: window.innerHeight },
        jsonUrl: {},
        graphData: {
            default: {
                nodes: [],
                links: []
            },
            onChange: function onChange(_, state) {
                state.onFrame = null;
            } // Pause simulation

        },
        numDimensions: { default: 3 },
        nodeRelSize: { default: 4 }, // volume per val unit
        nodeResolution: { default: 8 }, // how many slice segments in the sphere's circumference
        onNodeClick: {},
        lineOpacity: { default: 0.2 },
        autoColorBy: {},
        idField: { default: 'id' },
        valField: { default: 'val' },
        nameField: { default: 'name' },
        colorField: { default: 'color' },
        linkSourceField: { default: 'source' },
        linkTargetField: { default: 'target' },
        linkColorField: { default: 'color' },
        forceEngine: { default: 'd3' }, // d3 or ngraph
        warmupTicks: { default: 0 }, // how many times to tick the force engine at init before starting to render
        cooldownTicks: { default: Infinity },
        cooldownTime: { default: 15000 // ms
        } },

    init: function init(domNode, state) {
        // Wipe DOM
        domNode.innerHTML = '';

        // Add nav info section
        var navInfo = void 0;
        domNode.appendChild(navInfo = document.createElement('div'));
        navInfo.className = 'graph-nav-info';
        navInfo.textContent = "MOVE mouse & press LEFT/A: rotate, MIDDLE/S: zoom, RIGHT/D: pan";

        // Add info space
        domNode.appendChild(state.infoElem = document.createElement('div'));
        state.infoElem.className = 'graph-info-msg';
        state.infoElem.textContent = '';

        // Setup tooltip
        var toolTipElem = document.createElement('div');
        toolTipElem.classList.add('graph-tooltip');
        domNode.appendChild(toolTipElem);

        // Capture mouse coords on move
        var raycaster = new THREE.Raycaster();
        var mousePos = new THREE.Vector2();
        mousePos.x = -2; // Initialize off canvas
        mousePos.y = -2;
        domNode.addEventListener("mousemove", function (ev) {
            // update the mouse pos
            var offset = getOffset(domNode),
                relPos = {
                x: ev.pageX - offset.left,
                y: ev.pageY - offset.top
            };
            mousePos.x = relPos.x / state.width * 2 - 1;
            mousePos.y = -(relPos.y / state.height) * 2 + 1;

            // Move tooltip
            toolTipElem.style.top = relPos.y - 40 + 'px';
            toolTipElem.style.left = relPos.x - 20 + 'px';

            function getOffset(el) {
                var rect = el.getBoundingClientRect(),
                    scrollLeft = window.pageXOffset || document.documentElement.scrollLeft,
                    scrollTop = window.pageYOffset || document.documentElement.scrollTop;
                return { top: rect.top + scrollTop, left: rect.left + scrollLeft };
            }
        }, false);

        // Handle click events on nodes
        domNode.addEventListener("click", function (ev) {
            if (state.onNodeClick) {
                raycaster.setFromCamera(mousePos, state.camera);
                var intersects = raycaster.intersectObjects(state.graphScene.children).filter(function (o) {
                    return o.object.__data;
                }); // Check only objects with data (nodes)
                if (intersects.length) {
                    state.onNodeClick(intersects[0].object.__data);
                }
            }
        }, false);

        // Setup renderer
        state.renderer = new THREE.WebGLRenderer();
        domNode.appendChild(state.renderer.domElement);

        // Setup scene
        var scene = new THREE.Scene();
        scene.background = new THREE.Color(0xb5c8d6);
        scene.add(state.graphScene = new THREE.Group());

        // Add lights
        scene.add(new THREE.AmbientLight(0xbbbbbb));
        scene.add(new THREE.DirectionalLight(0xffffff, 0.6));

        // Setup camera
        state.camera = new THREE.PerspectiveCamera();
        state.camera.far = 20000;

        // Add camera interaction
        var tbControls = new trackballControls(state.camera, state.renderer.domElement);

        // Add D3 force-directed layout
        this.d3ForceLayout = state.d3ForceLayout = d3.forceSimulation().force('link', d3.forceLink()).force('charge', d3.forceManyBody()).force('center', d3.forceCenter()).stop();

        //

        // Kick-off renderer
        (function animate() {
            // IIFE
            if (state.onFrame) state.onFrame();

            // Update tooltip
            raycaster.setFromCamera(mousePos, state.camera);
            var intersects = raycaster.intersectObjects(state.graphScene.children).filter(function (o) {
                return o.object.name;
            }); // Check only objects with labels
            toolTipElem.textContent = intersects.length ? intersects[0].object.name : '';

            // Frame cycle
            tbControls.update();
            state.renderer.render(scene, state.camera);
            requestAnimationFrame(animate);
        })();
    },

    update: function updateFn(state) {
        resizeCanvas();

        state.onFrame = null; // Pause simulation
        state.infoElem.textContent = 'Loading...';

        if (state.graphData.nodes.length || state.graphData.links.length) {
            console.info('3d-force-graph loading', state.graphData.nodes.length + ' nodes', state.graphData.links.length + ' links');
        }

        if (!state.fetchingJson && state.jsonUrl && !state.graphData.nodes.length && !state.graphData.links.length) {
            // (Re-)load data
            state.fetchingJson = true;
            qwest.get(state.jsonUrl).then(function (_, json) {
                state.fetchingJson = false;
                state.graphData = json;
                updateFn(state); // Force re-update
            });
        }

        if (state.autoColorBy !== null) {
            // Auto add color to uncolored nodes
            autoColorNodes(state.graphData.nodes, accessorFn(state.autoColorBy), state.colorField);
        }

        // parse links
        state.graphData.links.forEach(function (link) {
            link.source = link[state.linkSourceField];
            link.target = link[state.linkTargetField];
        });

        // Add WebGL objects
        while (state.graphScene.children.length) {
            state.graphScene.remove(state.graphScene.children[0]);
        } // Clear the place

        var nameAccessor = accessorFn(state.nameField);
        var valAccessor = accessorFn(state.valField);
        var colorAccessor = accessorFn(state.colorField);
        var sphereGeometries = {}; // indexed by node value
        var sphereMaterials = {}; // indexed by color
        state.graphData.nodes.forEach(function (node) {
            var val = valAccessor(node) || 1;
            if (!sphereGeometries.hasOwnProperty(val)) {
                sphereGeometries[val] = new THREE.SphereGeometry(Math.cbrt(val) * state.nodeRelSize, state.nodeResolution, state.nodeResolution);
            }

            var color = colorAccessor(node);
            if (!sphereMaterials.hasOwnProperty(color)) {
                sphereMaterials[color] = new THREE.MeshLambertMaterial({
                    color: colorStr2Hex(color || '#ffffaa'),
                    transparent: true,
                    opacity: 0.75
                });
            }

            var sphere = new THREE.Mesh(sphereGeometries[val], sphereMaterials[color]);

            sphere.name = nameAccessor(node); // Add label
            sphere.__data = node; // Attach node data

            state.graphScene.add(node.__sphere = sphere);
        });

        var linkColorAccessor = accessorFn(state.linkColorField);
        var lineMaterials = {}; // indexed by color
        state.graphData.links.forEach(function (link) {
            var color = linkColorAccessor(link);
            if (!lineMaterials.hasOwnProperty(color)) {
                lineMaterials[color] = new THREE.LineBasicMaterial({
                    color: colorStr2Hex(color || '#f0f0f0'),
                    transparent: true,
                    opacity: state.lineOpacity
                });
            }

            var geometry = new THREE.BufferGeometry();
            geometry.addAttribute('position', new THREE.BufferAttribute(new Float32Array(2 * 3), 3));
            var lineMaterial = lineMaterials[color];
            var line = new THREE.Line(geometry, lineMaterial);

            line.renderOrder = 10; // Prevent visual glitches of dark lines on top of spheres by rendering them last

            state.graphScene.add(link.__line = line);
        });

        if (state.camera.position.x === 0 && state.camera.position.y === 0) {
            // If camera still in default position (not user modified)
            state.camera.lookAt(state.graphScene.position);
            state.camera.position.z = Math.cbrt(state.graphData.nodes.length) * CAMERA_DISTANCE2NODES_FACTOR;
        }

        // Feed data to force-directed layout
        var isD3Sim = state.forceEngine !== 'ngraph';
        var layout = void 0;
        if (isD3Sim) {
            // D3-force
            (layout = state.d3ForceLayout).stop().alpha(state.cooldownTicks <= 0 || state.cooldownTime <= 0 ? 0 : 1) // re-heat the simulation
            .numDimensions(state.numDimensions).nodes(state.graphData.nodes).force('link').id(function (d) {
                return d[state.idField];
            }).links(state.graphData.links);
        } else {
            // ngraph
            var _graph = ngraph.graph();
            state.graphData.nodes.forEach(function (node) {
                _graph.addNode(node[state.idField]);
            });
            state.graphData.links.forEach(function (link) {
                _graph.addLink(link.source, link.target);
            });
            layout = ngraph['forcelayout' + (state.numDimensions === 2 ? '' : '3d')](_graph);
            layout.graph = _graph; // Attach graph reference to layout
        }

        for (var i = 0; i < state.warmupTicks; i++) {
            layout[isD3Sim ? 'tick' : 'step']();
        } // Initial ticks before starting to render

        var cntTicks = 0;
        var startTickTime = new Date();
        state.onFrame = layoutTick;
        state.infoElem.textContent = '';

        //

        function resizeCanvas() {
            if (state.width && state.height) {
                state.renderer.setSize(state.width, state.height);
                state.camera.aspect = state.width / state.height;
                state.camera.updateProjectionMatrix();
            }
        }

        function layoutTick() {
            if (cntTicks++ > state.cooldownTicks || new Date() - startTickTime > state.cooldownTime) {
                state.onFrame = null; // Stop ticking graph
            }

            layout[isD3Sim ? 'tick' : 'step'](); // Tick it

            // Update nodes position
            state.graphData.nodes.forEach(function (node) {
                var sphere = node.__sphere;
                if (!sphere) return;

                var pos = isD3Sim ? node : layout.getNodePosition(node[state.idField]);

                sphere.position.x = pos.x;
                sphere.position.y = pos.y || 0;
                sphere.position.z = pos.z || 0;
            });

            // Update links position
            state.graphData.links.forEach(function (link) {
                var line = link.__line;
                if (!line) return;

                var pos = isD3Sim ? link : layout.getLinkPosition(layout.graph.getLink(link.source, link.target).id),
                    start = pos[isD3Sim ? 'source' : 'from'],
                    end = pos[isD3Sim ? 'target' : 'to'],
                    linePos = line.geometry.attributes.position;

                linePos.array[0] = start.x;
                linePos.array[1] = start.y || 0;
                linePos.array[2] = start.z || 0;
                linePos.array[3] = end.x;
                linePos.array[4] = end.y || 0;
                linePos.array[5] = end.z || 0;

                linePos.needsUpdate = true;
                line.geometry.computeBoundingSphere();
            });
        }
    }
});

module.exports = _3dForceGraph;
