ko.bindingHandlers.slideVisible = {
    init: function(element, valueAccessor) {
        var visible = ko.unwrap(valueAccessor());
        $(element).toggle(visible);
    },
    update: function(element, valueAccessor) {
        var visible = ko.unwrap(valueAccessor());
        if (visible) {
            $(element).hide().slideDown();
        } else {
            $(element).slideUp();
        }
    }
};

ko.bindingHandlers.tooltip = {
    init: function(element, valueAccessor) {
        var local = ko.utils.unwrapObservable(valueAccessor());
        var options = {placement: 'right'};
        ko.utils.extend(options, local);
        $(element).tooltip(options);
    }
};

ko.bindingHandlers.colorpicker = {
    init: function(element, valueAccessor) {
        var color = valueAccessor();
        $(element).colpick({
            onSubmit: function(hsb, hex) {
                color('#' + hex);
            }
        });
    }
};

ko.bindingHandlers.borderColor = {
    update: function(element, valueAccessor) {
        var color = ko.unwrap(valueAccessor());
        $(element).css('border-left-color', color);
        $(element).css('border-left-width', '4px');
    }
};

ko.bindingHandlers.toggleClick = {
    init: function (element, valueAccessor) {
        var value = valueAccessor();

        ko.utils.registerEventHandler(element, "click", function () {
            value(!value());
        });
    }
};

function ContigsetPage(contigset) {
    var self = this;
    self.contigset = contigset;

    self.plotContigsDirty = ko.observable(false);
    self.plotContigs = [];

    ko.computed(function() {
        var contigset = self.contigset();
        if (!contigset) return;
        console.log("ContigsetPage contigset update");

        // reset
        self.plotContigs = [];
        self.plotContigsDirty(true);

        //var queryOptions = {items: contigset.size(), fields: 'gc,length'};
        var queryOptions = {items: 3500, fields: 'gc,length'};
        $.getJSON('/contigsets/' + contigset.id + '/contigs', queryOptions, function(data) {
            self.plotContigs = data.contigs;
            self.plotContigsDirty(true);
        });
    });
}


/*
* PAGE FOR BINSET(refinement)
*   - BinsetPage
*   - ScatterplotPanel
*   - ContigTable
*   - BinTable
* */

function BinsetPage(contigset, binset) {
    var self = this;
    self.contigset = contigset;
    self.binset = binset;
    self.colorBinset = ko.observable(null);
    self.bins = ko.observableArray([]);
    self.binIds = ko.observableArray([]); // selected bins
    self.contigs = [];
    self.dirty = ko.observable(false);
    self.selectedContigs = ko.observableArray([]);

    self.binTable = new BinTable(self.binset, self.binIds, self.bins);
    //self.contigTable = new ContigTable(self.binset, self.bins, self.binIds,
    //    self.selectedContigs);
    self.contigTable = new ContigTable(self);
    self.scatterplotPanel = new ScatterplotPanel(self.binset, self.contigs,
        self.colorBinset, self.dirty);

    // Whether to show the bins table or the contigs table. This is a boolean
    // because it's easier to work with than using a flag.
    self.showBinsTab = ko.observable(true);

    // Get the contigs on bin selection change
    self.binIds.subscribe(function(changes) {
        changes.forEach(function(change) {
            if (change.status === 'added') getContigs(change.value);
            if (change.status === 'deleted') removeContigs(change.value);
        });
    }, null, 'arrayChange');

    ko.computed(function() {
        var binset = self.binset();
        self.bins([]);
        self.binIds([]);
        self.contigs = [];
        self.dirty(true);
    });

    function removeContigs(binId) {
        self.contigs = self.contigs.filter(function(contig) {
            return contig.bin != binId;
        });
        self.dirty(true);
    }

    function getContigs(binId) {
        var contigset = self.contigset(),
            binset = self.binset(),
            colorBinset = self.colorBinset.peek() || binset;

        var contigsUrl = '/contigsets/' + contigset.id + '/contigs',
            contigsPayload = {fields: 'id,length,gc,name', bins: binId,
                items: contigset.size(), coverages: true},
            binsUrl = '/contigsets/' + contigset.id + '/binsets/' + colorBinset.id + '/bins',
            binsPayload = {fields: 'color', contigs: true};
        $.when(
            $.getJSON(contigsUrl, contigsPayload),
            $.getJSON(binsUrl, binsPayload)
        ).done(function(contigs, bins) {
            var contigColors = {};
            bins[0].bins.forEach(function(bin) {
                bin.contigs.forEach(function(contig) {
                    contigColors[contig] = bin.color;
                });
            });

            $.merge(self.contigs, contigs[0].contigs.map(function(contig) {
                contig.color = contigColors[contig.id];
                contig.bin = binId;
                return contig;
            }));

            self.dirty(true);
        });
    }

    // Update contig color when new color binset is selected.
    ko.computed(function() {
        var colorBinset = self.colorBinset() || self.binset(),
            binset = self.binset();
        if (!colorBinset || !binset) return;

        var binsUrl = '/contigsets/' + binset.contigset + '/binsets/' + colorBinset.id + '/bins',
            binsPayload = {fields: 'color', contigs: true};
        $.getJSON(binsUrl, binsPayload, function(data) {
            var contigColors = {};
            data.bins.forEach(function(bin) {
                bin.contigs.forEach(function(contig) {
                    contigColors[contig] = bin.color;
                });
            });

            self.contigs = self.contigs.map(function(contig) {
                contig.color = contigColors[contig.id] || '#000000';
                return contig;
            });

            self.dirty(true);
        });
    })
}

function ScatterplotPanel(binset, contigs, colorBinset, dirty) {
    var self = this;
    self.binset = binset;
    self.contigs = contigs;
    self.colorBinset = colorBinset;
    self.dirty = dirty;

    self.xData = ko.observable('gc');
    self.xLogarithmic = ko.observable(false);

    self.yData = ko.observable('length');
    self.yLogarithmic = ko.observable(false);

    ko.computed(function() {
        var binset = self.binset();
        if (!binset) return;
        self.colorBinset(binset);
    });
}

function ContigTable(parent) {
    var self = this;
    self.actions = ko.observableArray([
        {name: 'Move', value: 'move', enable: true},
        {name: 'Remove', value: 'remove', enable: true}]);
    self.action = ko.observable();
    self.toBin = ko.observable(); // The bin the contigs should be moved to.

    // Parent properties
    self.binIds = parent.binIds;
    self.binset = parent.binset;
    self.bins = parent.bins;
    self.contigs = parent.selectedContigs;
    self.parent = parent;

    self.contigIds = ko.pureComputed(function() {
        return self.contigs().map(function(contig) { return contig.id });
    });

    // Contigs can be manipulated one bin at a time - for now.
    self.fromBin = ko.computed(function() {
        var binIds = self.binIds();
        var oneSelected = binIds.length == 1;
        self.actions(self.actions().map(function(action) {
            action.enable = oneSelected;
            return action;
        }));
        return oneSelected ? binIds[0] : null;
    });

    self.updateBin = function(binId, newBin) {
        var bin = self.bins().filter(function(bin) { return bin.id == binId})[0];
        self.bins()[self.bins.indexOf(bin)] = newBin;
    };

    self.updateParent = function() {
        var contigsToRemove = self.contigs();
        self.parent.contigs = self.parent.contigs.filter(function(contig) {
            return contigsToRemove.indexOf(contig) == -1;
        });
        self.parent.dirty(true);
    };

    self.move = function() {
        console.log('Moving contigs:');
        var binset = self.binset(),
            url = '/contigsets/' + binset.contigset + '/binsets/' + binset.id + '/bins/',
            contigs = self.contigIds().join(','),
            fromBin = self.fromBin(),
            toBin = self.toBin();
        self.action(self.action().enable = false);
        $.when(
            $.ajax({
                url: url + fromBin,
                type: 'PUT',
                data: {contigs: contigs, action: 'remove'}
            }),
            $.ajax({
                url: url + toBin,
                type: 'PUT',
                data: {contigs: contigs, action: 'add'}
            })
        ).done(function(from, to) {
            self.updateParent();
            self.contigs([]);

            self.updateBin(fromBin, new Bin(from[0]));
            self.updateBin(toBin, new Bin(to[0]));
            self.bins.valueHasMutated();

            self.action(self.action().enable = true);
        });
    };

    self.remove = function() {
        console.log('remove contigs');
    };
}

function BinTable(binset, binIds, bins) {
    var self = this;
    self.binset = binset;
    self.binIds = binIds;
    self.bins = bins;

    self.sort = function(by) {
        //if (!$.isNumeric(self.bins()[0][by])) return self.bins.sort();
        return self.bins.sort(function(left, right) {
            if (left[by] == right[by]) return 0;
            return left[by] < right[by] ? -1 : 1;
        });
    };

    self.deleteBins = function() {
        var binset = self.binset();
        if (!binset) return;
        var ids = self.binIds();
        $.ajax({
            url: '/contigsets/' + binset.contigset + '/binsets/' + binset.id + '/bins',
            type: 'DELETE',
            data: {ids: ids.join(",")}
        });
        self.binIds([]);
        self.bins.remove(function(bin) { return ids.indexOf(bin.id) > -1; });
    };

    ko.computed(function() {
        var binset = self.binset();
        self.bins([]);
        if (!binset) return;
        var url = '/contigsets/' + binset.contigset + '/binsets/' + binset.id + '/bins';
        $.getJSON(url, function(data) {
            self.bins(data.bins.map(function(bin) { return new Bin(bin); }));
        });
    });
}



/*
 * PAGE FOR BINSETS
 *  - ChordPanel
 * */

function ChordPanel(contigset) {
    var self = this;
    self.contigset = contigset;
    self.binset1 = ko.observable(null);
    self.binset2 = ko.observable(null);

    self.selectedBin = ko.observable();
    self.selectedBinInfo = ko.observable();
    self.hoveredBin = ko.observable();

    self.unifiedColor = ko.observable(false);
    self.matrix = [];
    self.dirty = ko.observable(false);

    self.bins1 = [];
    self.bins2 = [];

    // Update binset info.
    ko.computed(function() {
        var bin = self.selectedBin();
        if (!bin) return;

        self.selectedBinInfo(null);
        var contigset = self.contigset(),
            url = '/contigsets/' + contigset.id + '/binsets/';
        url += self.bins1.indexOf(bin) > -1 ? self.binset1().id : self.binset2().id;
        url += '/bins/' + bin.id;
        $.getJSON(url, self.selectedBinInfo);
    });

    self.connectedBins = ko.computed(function() {
        var bin = self.hoveredBin();
        if (!bin) bin = self.selectedBin();
        if (!bin) return;

        var bins = self.bins1.concat(self.bins2);
        var matrixRow = self.matrixRowByBinId(bin.id);
        var connectedWith = [];
        for (var i = 0; i < bins.length; i++) {
            if (matrixRow[i] == 0) continue;
            var b = bins[i];
            b.percentage = (matrixRow[i] / bin.size) * 100;
            b.percentage = +b.percentage.toFixed(2); // round to 2 decimals
            connectedWith.push(b);
        }
        connectedWith.sort(function(a, b) { return a.percentage < b.percentage; });
        return connectedWith;
    });

    self.matrixRowByBinId = function(binId) {
        var bins = self.bins1.concat(self.bins2);
        for (var i = 0; i < bins.length; i++) {
            if (bins[i].id == binId) break;
        }
        return self.matrix[i];
    };

    self.selectNextBin = function() {
        var bin = self.selectedBin();
        if (!bin) return;

        var bins = self.bins1.concat(self.bins2),
            index = bins.indexOf(bin),
            nextIndex = index + 1 === bins.length - 1 ? 0 : index + 1;
        self.selectedBin(bins[nextIndex]);
    };

    self.selectPreviousBin = function() {
        var bin = self.selectedBin();
        if (!bin) return;

        var bins = self.bins1.concat(self.bins2),
            index = bins.indexOf(bin),
            prevIndex = index === 0 ? bins.length - 1 : index - 1;
        self.selectedBin(bins[prevIndex]);
    };

    self.updateChordPanel = function() {
        var binsets = [self.binset1(), self.binset2()],
            data = {binset1: binsets[0].id, binset2: binsets[1].id},
            url = '/contigsets/' + binsets[0].contigset + '/binsets/';

        // Create the matrix
        $.getJSON('/contigsets/' + binsets[0].contigset + '/matrix', data, function(data) {
            self.bins1 = data.bins1;
            self.bins2 = data.bins2;
            self.matrix = data.matrix;

            $.when(
                $.getJSON(url + binsets[0].id + '/bins', {fields: 'id,name,color,size'}),
                $.getJSON(url + binsets[1].id + '/bins', {fields: 'id,name,color,size'})
            ).done(function(bins1, bins2) {
                bins1[0].bins.forEach(function(bin) {
                    bin.binsetColor = binsets[0].color();
                    self.bins1[self.bins1.indexOf(bin.id)] = bin;
                });
                bins2[0].bins.forEach(function(bin) {
                    bin.binsetColor = binsets[1].color();
                    self.bins2[self.bins2.indexOf(bin.id)] = bin;
                });

                self.dirty(true);
            });
        });
    };

    ko.computed(function() {
        self.unifiedColor();
        self.dirty(true);
    });

    ko.computed(function() {
        self.contigset();
        self.matrix = [];
        self.bins1 = [];
        self.bins2 = [];
        self.unifiedColor(false);
        self.dirty(true);
        self.selectedBin(null);
        self.selectedBinInfo(null);
        self.hoveredBin(null);
    });
}

function ContigSection() {
    var self = this;
    self.contigs = ko.observableArray([]);
    self.contigsetId = ko.observable();
    self.showFilters = ko.observable(false);
    self.toggleFilters = function() { self.showFilters(!self.showFilters()); };

    // contig selection
    self.allContigsSelected = ko.observable(false);
    self.selectedContigIds = ko.observableArray([]);
    self.selectedAmount = ko.pureComputed(function() {
        if (self.allContigsSelected()) return self.count();
        return self.selectedContigIds().length;
    });
    ko.computed(function() {
        var contigsetId = self.contigsetId();

        // Unselect all contigs
        self.selectedContigIds([]);
        self.allContigsSelected(false);
    });

    // table
    self.sortBy = ko.observable('name');
    self.sort = function(field) {
        var sortBy = self.sortBy();
        field === sortBy ? self.sortBy('-' + field) : self.sortBy(field);
    };

    // pagination
    self.index = ko.observable(1);
    self.count = ko.observable(null);
    self.indices = ko.observable(null);

    // New contigset selected
    ko.computed(function() {
        var contigsetId = self.contigsetId();
        if (!contigsetId) return;

        // reset
        self.contigs([]);
        self.count(null);
        self.indices(null);

        // Get new contig data
        var index = self.index(),
            sort = self.sortBy(),
            queryOptions = {index: index, sort: sort, items: 7,
                fields: 'id,name,gc,length'};
        $.getJSON('/contigsets/' + contigsetId + '/contigs', queryOptions, function(data) {
            self.contigs(data.contigs);
            self.count(data.count);
            self.indices(data.indices);
        });
    });
}

function Bin(data) {
    var self = this;
    self.id = data.id;
    self.name = data.name;
    self.binset = data.binset_id;
    self.color = ko.observable(data.color);
    self.size = data.size;
    self.gc = data.gc;
    self.n50 = data.N50;
    //self.contamination = data.contamination;
    //self.completeness = data.completeness;
    self.contamination = Math.floor(Math.random() * 100);
    self.completeness = Math.floor(Math.random() * 100);
}


function Binset(data) {
    var self = this;
    self.id = data.id;
    self.contigset = data.contigset;
    self.name = ko.observable(data.name);
    self.color = ko.observable(data.color);
    self.bins = ko.observableArray(data.bins);

    // Renaming
    self.renaming = ko.observable(false);
    self.rename = function() { self.renaming(true); };
    ko.computed(function() {
        var name = self.name();
        $.ajax({
            url: '/contigsets/' + self.contigset + '/binsets/' + self.id,
            type: 'PUT',
            data: {'name': name}
        });
    });
}

function Contigset(data) {
    var self = this;
    self.id = data.id;
    self.samples = data.samples;
    self.name = ko.observable(data.name);
    self.size = ko.observable(data.size); // amount of contigs

    // Renaming
    self.renaming = ko.observable(false);
    self.rename = function() { self.renaming(true); };
    ko.computed(function() {
        var name = self.name();
        $.ajax({
            url: '/contigsets/' + self.id,
            type: 'PUT',
            data: {'name': name}
        });
    });
}

function ViewModel() {
    var self = this;
    self.contigsets = ko.observableArray([]);
    self.binsets = ko.observableArray([]);
    self.selectedContigset = ko.observable(null);
    self.selectedBinset = ko.observable(null);
    self.contigSection = new ContigSection();
    self.contigsetPage = new ContigsetPage(self.selectedContigset);
    self.binsetPage = new BinsetPage(self.selectedContigset, self.selectedBinset);
    self.chordPanel = new ChordPanel(self.selectedContigset);

    self.debug = ko.observable(false);

    // On which breadcrumb (nav bar on the top right) we are.
    self.CrumbEnum = {
        CONTIGSETS: 1,
        CONTIGSET: 2,
        BINSETS: 3,
        BINSET: 4
    };
    self.crumb = ko.observable(self.CrumbEnum.CONTIGSETS);

    // On contigset change
    ko.computed(function() {
        self.selectedBinset(null);
        var contigset = self.selectedContigset();
        if (contigset) { // A contigset has been selected
            self.crumb(self.CrumbEnum.CONTIGSET);
            self.contigSection.contigsetId(contigset.id); // Update contig table

            $.getJSON('/contigsets/' + contigset.id + '/binsets', function(data) {
                self.binsets(data.binsets.map(function(bs) { return new Binset(bs); }));
            });
        } else {
            self.crumb(self.CrumbEnum.CONTIGSETS);
            self.binsets([]);
        }
    });

    // On binset change
    ko.computed(function() {
        var binset = self.selectedBinset();
        if (binset) self.crumb(self.CrumbEnum.BINSET);
    });

    // On crumb change
    ko.computed(function() {
        var crumb = self.crumb();
        switch (crumb) {
            case self.CrumbEnum.CONTIGSETS:
                //self.selectedBinset(null);
                //self.selectedContigset(null);
                break;
            case self.CrumbEnum.CONTIGSET:
                //self.selectedBinset(null);
                break;
            case self.CrumbEnum.BINSETS:
                //self.selectedBinset(null);
                break;
            case self.CrumbEnum.BINSET:
                break;
        }
    });

    self.showElement = function(elem) { if (elem.nodeType === 1) $(elem).hide().slideDown() };
    self.hideElement = function(elem) { if (elem.nodeType === 1) $(elem).slideUp(function() { $(elem).remove(); }) };
    
    // Data deletion
    self.deleteBinset = function() {
        var binset = self.selectedBinset();
        $.ajax({
            url: '/contigsets/' + binset.contigset + '/binsets/' + binset.id,
            type: 'DELETE',
            success: function(response) {
            }
        });
        self.binsets.remove(binset);
        self.selectedBinset(null);
        self.crumb(self.CrumbEnum.BINSETS);
    };

    self.deleteContigset = function() {
        var contigset = self.selectedContigset();
        $.ajax({
            url: '/contigsets/' + contigset.id,
            type: 'DELETE',
            success: function(response) {
            }
        });
        self.contigsets.remove(contigset);
        self.selectedContigset(null);
    };

    // Data upload
    self.uploadContigset = function(formElement) {
        var formData = new FormData(formElement);
        formElement.reset();
        $.ajax({
            url: '/contigsets',
            type: 'POST',
            data: formData,
            async: false,
            success: function (data) {
                self.contigsets.push(new Contigset(data));
            },
            cache: false,
            contentType: false,
            processData: false
        });
    };

    self.uploadBinset = function(formElement) {
        var formData = new FormData(formElement);
        formElement.reset();

        $.ajax({
            url: '/contigsets/' + self.selectedContigset().id + '/binsets',
            type: 'POST',
            data: formData,
            async: false,
            success: function (data) {
                self.binsets.push(new Binset(data));
            },
            cache: false,
            contentType: false,
            processData: false
        });
    };

    // Data
    $.getJSON('/contigsets', function(data) {
        self.contigsets($.map(data.contigsets, function(cs) { return new Contigset(cs); }));
    });
}

$(function() {
    ko.applyBindings(new ViewModel());
});
