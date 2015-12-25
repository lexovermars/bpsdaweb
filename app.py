from collections import defaultdict
import uuid
import json

import werkzeug
from flask import Flask, render_template, g, session, abort, request
from flask.ext.sqlalchemy import SQLAlchemy
from flask_restful import Api, Resource, reqparse
import flask_sijax

import utils
import randomcolor


app = Flask(__name__)
app.config.from_object('config')
db = SQLAlchemy(app)
api = Api(app)
flask_sijax.Sijax(app)
randcol = randomcolor.RandomColor()


''' Database '''
bincontig = db.Table('bincontig',
    db.Column('bin_id', db.Integer, db.ForeignKey('bin.id')),
    db.Column('contig_id', db.Integer, db.ForeignKey('contig.id'))
)


class Bin(db.Model):
    __tablename__ = 'bin'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(25))
    binset_id = db.Column(db.Integer, db.ForeignKey('binset.id'))
    color = db.Column(db.String(7), default='#ffffff')
    contigs = db.relationship('Contig', secondary=bincontig,
                              backref=db.backref('bins', lazy='dynamic'))


class Contig(db.Model):
    __tablename__ = 'contig'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120))
    sequence = db.Column(db.String)
    contigset_id = db.Column(db.Integer, db.ForeignKey('contigset.id'))


class Binset(db.Model):
    __tablename__ = 'binset'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50))
    color = db.Column(db.String(7))
    bins = db.relationship('Bin', backref='binset', lazy='dynamic')
    contigset_id = db.Column(db.Integer, db.ForeignKey('contigset.id'))


class Contigset(db.Model):
    __tablename__ = 'contigset'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50))
    userid = db.Column(db.String)
    contigs = db.relationship('Contig', backref='contigset', lazy='dynamic')
    binsets = db.relationship('Binset', backref='contigset', lazy='dynamic')


''' Sijax '''
class SijaxHandler(object):
    @staticmethod
    def _add_alert(obj_response, div, text):
        obj_response.html(div, """
        <div class="alert alert-warning alert-dismissible" role="alert">
            <button type="button" class="close" data-dismiss="alert"
                    aria-label="Close"><span aria-hidden="true">&times;</span>
            </button>
            {}
        </div>
        """.format(text))

    @staticmethod
    def contigset_form_handler(obj_response, files, form_values):
        # Clean form
        obj_response.reset_form()

        # Validate input
        contig_file = files.get('contigsetFile')
        contigset_name = form_values.get('contigsetName')[0]
        if '' in (contig_file.filename, contigset_name):
            SijaxHandler._add_alert(obj_response, '#contigsetAlerts',
                                    'Onjuiste input.')
            return

        contigset = Contigset.query.filter_by(name=contigset_name,
                                              userid=session['uid']).first()
        if contigset is not None:
            SijaxHandler._add_alert(obj_response, '#contigsetAlerts',
                                    'Contigs zijn al geupload.')
            return

        # Add data to database
        contigs = []
        for header, sequence in utils.parse_fasta(contig_file.stream):
            contigs.append(Contig(name=header, sequence=sequence))

        contigset = Contigset(name=contigset_name, userid=session['uid'],
            contigs=contigs)

        db.session.add(contigset)
        db.session.commit()

    @staticmethod
    def binset_form_handler(obj_response, files, form_values):
        # Clean form
        obj_response.reset_form()
        obj_response.remove('#binTable > tbody > tr')

        # Validate input
        bin_file = files.get('binsetFile')
        binset_name = form_values.get('binsetName')[0]
        contigset_name = form_values.get('binsetContigset')[0]
        if '' in (bin_file.filename, binset_name):
            SijaxHandler._add_alert(obj_response, '#binsetAlerts',
                                    'Onjuiste input.')
            return

        # TODO: use id instead of name
        contigset = Contigset.query.filter_by(name=contigset_name,
            userid=session['uid']).first()

        bin_contigs = defaultdict(list)
        contig_bins = {}
        for contig_name, bin_name in utils.parse_dsv(bin_file):
            bin_contigs[bin_name].append(contig_name)
            contig_bins[contig_name] = bin_name

        bins = []
        if contigset is None:
            contigs = []
            for bin_name, bin_contigs in bin_contigs.items():
                bin_contigs = [Contig(name=c) for c in bin_contigs]
                bin = Bin(name=bin_name, color=randcol.generate()[0],
                    contigs=bin_contigs)
                contigs.extend(bin_contigs)
                bins.append(bin)

            contigset = Contigset(name='contigset', userid=session['uid'],
                contigs=contigs)
            db.session.add(contigset)
        else:
            done = {}
            for contig in contigset.contigs:
                bin_name = contig_bins.get(contig.name)
                if not bin_name:
                    continue
                bin = done.get(bin_name)
                if bin is None:
                    bin = Bin(name=bin_name, color=randcol.generate()[0])
                    bins.append(bin)
                    done[bin_name] = bin
                bin.contigs.append(contig)

        binset = Binset(name=binset_name, color=randcol.generate()[0],
            bins=bins, contigset=contigset)

        db.session.add(binset)
        db.session.commit()


''' API '''
def user_contigset_or_404(id):
    userid = session.get('uid')
    if userid is None:
        abort(404)
    contigset = Contigset.query.filter_by(userid=userid, id=id).first()
    if contigset is None:
        abort(404)
    return contigset


class ContigsetListApi(Resource):
    def __init__(self):
        self.reqparse = reqparse.RequestParser()
        self.reqparse.add_argument('name', type=str, default='contigset',
            location='form')
        self.reqparse.add_argument('contigs', required=True,
            type=werkzeug.datastructures.FileStorage, location='files')
        super(ContigsetListApi, self).__init__()

    def get(self):
        userid = session.get('uid')
        if userid is None:
            abort(404)
        result = []
        for contigset in Contigset.query.filter_by(userid=userid).all():
            result.append({'name': contigset.name, 'id': contigset.id,
                           'length': contigset.contigs.count(),
                           'binsets': [binset.id for binset in contigset.binsets]})
        return {'contigsets': result}

    def post(self):
        args = self.reqparse.parse_args()
        contigs = []
        for header, sequence in utils.parse_fasta(args.contigs.stream):
            contigs.append(Contig(name=header, sequence=sequence))

        contigset = Contigset(name=args.name, userid=session['uid'],
            contigs=contigs)

        db.session.add(contigset)
        db.session.commit()

        return {'id': contigset.id, 'name': args.name, 'length': len(contigs),
            'binsets': []}


class ContigsetApi(Resource):
    def __init__(self):
        self.reqparse = reqparse.RequestParser()
        self.reqparse.add_argument('name', type=str, location='form')
        super(ContigsetApi, self).__init__()

    def get(self, id):
        contigset = user_contigset_or_404(id)
        return {
            'name': contigset.name,
            'contigs': [c.id for c in contigset.contigs],
            'binsets': [binset.id for binset in contigset.binsets]
        }

    def put(self, id):
        args = self.reqparse.parse_args()
        contigset = user_contigset_or_404(id)
        if args.name is not None:
            contigset.name = args.name
        db.session.commit()

    def delete(self, id):
        contigset = user_contigset_or_404(id)
        contigset.contigs.delete()
        contigset.binsets.delete()
        db.session.delete(contigset)
        db.session.commit()


class ContigListApi(Resource):
    def get(self, contigset_id):
        contigset = user_contigset_or_404(contigset_id)
        result = []
        for contig in contigset.contigs:
            gc = utils.gc_content(contig.sequence) if contig.sequence else '-'
            length = len(contig.sequence) if contig.sequence else '-'
            result.append({'id': contig.id, 'name': contig.name, 'gc': gc,
                'length': length})
        return {'contigs': result}


class ContigApi(Resource):
    def get(self, contigset_id, id):
        contigset = user_contigset_or_404(contigset_id)
        contig = contigset.contigs.filter_by(id=id).first()
        if contig is None:
            abort(404)
        return {
            'name': contig.name,
            'id': contig.id,
            'sequence': contig.sequence
        }


api.add_resource(ContigsetListApi, '/contigsets')
api.add_resource(ContigsetApi, '/contigsets/<int:id>')
api.add_resource(ContigListApi, '/contigsets/<int:contigset_id>/contigs')
api.add_resource(ContigApi, '/contigsets/<int:contigset_id>/contigs/<int:id>')

''' Views '''
@app.before_request
def make_session_permanent():
    session.permanent = True


@app.route('/binsets/')
def get_binsets():
    userid = session.get('uid')
    if userid is None:
        abort(404)
    result = []
    binsets = [bs for cs in Contigset.query.filter_by(userid=userid).all()
               for bs in cs.binsets.all()]
    for binset in binsets:
        result.append({'name': binset.name, 'color': binset.color,
           'id': binset.id, 'bins': [bin.id for bin in binset.bins],
           'contigset': binset.contigset_id})
    return json.dumps(result)


@app.route('/binsets/<int:binset_id>')
def get_bins(binset_id):
    userid = session.get('uid')
    if userid is None:
        abort(404)
    contigsets = Contigset.query.filter_by(userid=userid).all()
    for contigset in contigsets:
        binset = contigset.binsets.filter_by(id=binset_id).first()
        if binset is not None: break
    if binset is None:
        abort(404)
    result = []
    for bin in utils.sort_bins(binset.bins):
        result.append({'id': bin.id, 'name': bin.name, 'color': bin.color,
            'contigs': [contig.id for contig in bin.contigs]})
    return json.dumps(result)


@app.route('/contigsets/')
def get_contigsets():
    userid = session.get('uid')
    if userid is None:
        abort(404)
    result = []
    for contigset in Contigset.query.filter_by(userid=userid).all():
        result.append({'name': contigset.name, 'id': contigset.id,
            'length': contigset.contigs.count(),
            'binsets': [binset.id for binset in contigset.binsets]})
    return json.dumps(result)


@app.route('/contigsets/<int:contigset_id>')
def get_contigs(contigset_id):
    userid = session.get('uid')
    if userid is None:
        abort(404)
    contigset = Contigset.query.filter_by(userid=userid, id=contigset_id).first()
    if contigset is None:
        abort(404)
    index = int(request.args.get('index', 1))
    items = int(request.args.get('items', 50))
    contigs = contigset.contigs.paginate(index, items, False).items
    result = []
    for contig in contigs:
        gc = utils.gc_content(contig.sequence) if contig.sequence else '-'
        length = len(contig.sequence) if contig.sequence else '-'
        result.append({'id': contig.id, 'name': contig.name, 'gc': gc,
                       'coverage': 1, 'length': length})
    return json.dumps(result)


@app.route('/to_matrix')
def to_matrix():
    userid = session.get('uid')
    if userid is None:
        abort(404)
    bins = request.args.get('bins')
    if bins is None:
        abort(400)
    bins = Bin.query.filter(Bin.id.in_(bins.split(','))).all()
    return json.dumps(utils.to_matrix(bins))


@flask_sijax.route(app, '/')
def home():
    new_user = False
    if not 'uid' in session:
        new_user = True
        session['uid'] = str(uuid.uuid4())

    form_init_js = g.sijax.register_upload_callback('contigsetForm',
        SijaxHandler.contigset_form_handler)
    form_init_js += g.sijax.register_upload_callback('binsetForm',
        SijaxHandler.binset_form_handler)

    if g.sijax.is_sijax_request:
        g.sijax.register_object(SijaxHandler)
        return g.sijax.process_request()

    return render_template('index.html', form_init_js=form_init_js,
                           new_user=new_user)


if __name__ == '__main__':
    app.run(debug=True)
