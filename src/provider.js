(function (module) {

    var analytics = window.analytics = window.analytics || [];

    // Invoked flag, to make sure the snippet
    // is never invoked twice.
    if (analytics.invoked) {
        console.error('Segment or ngSegment included twice.');
    } else {
        analytics.invoked = true;
    }

    // Define a factory to create stubs. These are placeholders
    // for methods in Analytics.js so that you never have to wait
    // for it to load to actually record data. The `method` is
    // stored as the first argument, so we can replay the data.
    analytics.factory = function (method) {
        return function () {
            var args = Array.prototype.slice.call(arguments);
            args.unshift(method);
            analytics.push(args);
            return analytics;
        };
    };

    analytics.SNIPPET_VERSION = '4.0.0';

    /**
     * Segment service
     * @param config
     * @constructor
     */
    function Segment(config) {

        this.config = config;

        // Checks condition before calling Segment method
        this.factory = function (method) {
            var _this = this;
            return function () {

                // If a condition has been set, only call the Segment method if it returns true
                if (_this.config.condition && !_this.config.condition(method, arguments)) {
                    _this.debug('Not calling method, condition returned false.', {
                        method: method,
                        arguments: arguments,
                    });
                    return;
                }

                //  No condition set, call the Segment method
                _this.debug('Calling method ' + method + ' with arguments:', arguments);
                return window.analytics[method].apply(analytics, arguments);
            };
        };
    }

    /**
     * Methods available on both segment service and segmentProvider
     * @type {{init: Function, debug: Function}}
     */
    Segment.prototype = {

        // Creates analytics.js method stubs
        init: function () {
            for (var i = 0; i < this.config.methods.length; i++) {
                var key = this.config.methods[i];

                // Only create analytics stub if it doesn't already exist
                if (!analytics[key]) {
                    analytics[key] = analytics.factory(key);
                }

                this[key] = this.factory(key);
            }
        },

        debug: function () {
            if (this.config.debug) {
                arguments[0] = this.config.tag + arguments[0];
                console.log.apply(console, arguments);
                return true;
            }
        },
    };

    /**
     * Segment provider available during .config() Angular app phase. Inherits from Segment prototype.
     * @param segmentDefaultConfig
     * @constructor
     * @extends Segment
     */
    function SegmentProvider(segmentDefaultConfig) {

        this.config = angular.copy(segmentDefaultConfig);

        // Stores any analytics.js method calls
        this.queue = [];

        // Overwrite Segment factory to queue up calls if condition has been set
        this.factory = function (method) {
            var queue = this.queue;
            return function () {

                // Defer calling analytics.js methods until the service is instantiated
                queue.push({ method: method, arguments: arguments });
            };
        };

        // Create method stubs using overridden factory
        this.init();

        this.setKey = function (apiKey) {
            this.config.apiKey = apiKey;
            this.validate('apiKey');
            return this;
        };

        this.setLoadDelay = function (milliseconds) {
            this.config.loadDelay = milliseconds;
            this.validate('loadDelay');
            return this;
        };

        this.setCondition = function (callback) {
            this.config.condition = callback;
            this.validate('condition');
            return this;
        };

        this.setEvents = function (events) {
            this.events = events;
            return this;
        };

        this.setConfig = function (config) {
            if (!angular.isObject(config)) {
                throw new Error(this.config.tag + 'Config must be an object.');
            }

            angular.extend(this.config, config);

            // Validate new settings
            var _this = this;
            Object.keys(config).forEach(function (key) {
                _this.validate(key);
            });

            return this;
        };

        this.setAutoload = function (bool) {
            this.config.autoload = !!bool;
            return this;
        };

        this.setDebug = function (bool) {
            this.config.debug = !!bool;
            return this;
        };

        var validations = {
            apiKey: function (config) {
                if (!angular.isString(config.apiKey) || !config.apiKey) {
                    throw new Error(config.tag + 'API key must be a valid string.');
                }
            },

            loadDelay: function (config) {
                if (!angular.isNumber(config.loadDelay)) {
                    throw new Error(config.tag + 'Load delay must be a number.');
                }
            },

            condition: function (config) {
                if (!angular.isFunction(config.condition) &&
                    !(angular.isArray(config.condition) &&
                      angular.isFunction(config.condition[config.condition.length - 1]))
                    ) {
                    throw new Error(config.tag + 'Condition callback must be a function or array.');
                }
            },
        };

        // Allows validating a specific property after set[Prop]
        // or all config after provider/constant config
        this.validate = function (property) {
            if (typeof validations[property] === 'function') {
                validations[property](this.config);
            }
        };

        this.createService = function ($injector, segmentLoader) {

            // Apply user-provided config constant if it exists
            if ($injector.has('segmentConfig')) {
                var constant = $injector.get('segmentConfig');
                if (!angular.isObject(constant)) {
                    throw new Error(this.config.tag + 'Config constant must be an object.');
                }

                angular.extend(this.config, constant);
                this.debug('Found segment config constant');

                // Validate settings passed in by constant
                var _this = this;
                Object.keys(constant).forEach(function (key) {
                    _this.validate(key);
                });
            }

            // Autoload Segment on service instantiation if an API key has been set via the provider
            if (this.config.autoload) {
                this.debug('Autoloading Analytics.js');
                if (this.config.apiKey) {
                    segmentLoader.load(this.config.apiKey, this.config.loadDelay, this.config.debug);
                } else {
                    this.debug(this.config.tag + ' Warning: API key is not set and autoload is not disabled.');
                }
            }

            // Create dependency-injected condition
            if (typeof this.config.condition === 'function' ||
                (typeof this.config.condition === 'array' &&
                 typeof this.config.condition[this.config.condition - 1] === 'function')
                ) {
                var condition = this.config.condition;
                this.config.condition = function (method, params) {
                    return $injector.invoke(condition, condition, { method: method, params: params });
                };
            }

            // Pass any provider-set configuration down to the service
            var segment = new Segment(angular.copy(this.config));

            // Transfer events if set
            if (this.events) {
                segment.events = angular.copy(this.events);
            }

            // Set up service method stubs
            segment.init();

            // Play back any segment calls that were made against the provider now that the
            // condition callback has been injected with dependencies
            this.queue.forEach(function (item) {
                segment[item.method].apply(segment, item.arguments);
            });

            return segment;
        };

        // Returns segment service and creates dependency-injected condition callback, if provided
        this.$get = ['$injector', 'segmentLoader', this.createService];
    }

    SegmentProvider.prototype = Object.create(Segment.prototype);

    // Register with Angular
    module.provider('segment', ['segmentDefaultConfig', SegmentProvider]);

})(angular.module('ngSegment'));
